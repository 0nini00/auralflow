import {
  createListeningSession, createListeningStatsIndex, LISTENING_CHECKPOINT_MS, parseListeningEvents,
  sampleListeningSession, seekListeningSession,
  type ListeningEvent, type ListeningSample, type ListeningSession, type ListeningStats, type MusicInfo,
} from '@lx/core';
import { create } from 'zustand';
import { libraryReset, loadListeningStats, saveListeningStatsMonth } from '@lx/tauri-bridge';
import { markNamespaceDegraded, registerLibraryPersistence, registerLibraryFlushHook, type LibraryPersistenceController } from './libraryPersistence';

interface ListeningStatsState {
  events: ListeningEvent[];
  revision: number;
  getStats: () => ListeningStats;
  error: string | null;
  /** 磁盘水合完成前不要渲染“还没有播放记录”，否则冷启动会先闪一次空态。 */
  loaded: boolean;
  record: (event: ListeningEvent) => void;
}
const buckets = new Map<string, Map<string, ListeningEvent>>();
const positions = new Map<string, number>();
const dirty = new Map<string, number>();
let nextRevision = 0;
let statsIndex = createListeningStatsIndex();
let migrationPending = false;
let loadError: Error | null = null;
let writes: Promise<void> = Promise.resolve();
let writing = false;
const eventMonth = (event: ListeningEvent) => new Date(event.startedAt).toISOString().slice(0, 7);
function putEvent(event: ListeningEvent): void {
  const month = eventMonth(event);
  const bucket = buckets.get(month) ?? new Map<string, ListeningEvent>();
  bucket.set(event.sessionId, event);
  buckets.set(month, bucket);
}

export const useListeningStatsStore = create<ListeningStatsState>((set, get) => ({
  events: [], revision: 0, getStats: () => statsIndex.snapshot(),
  error: null,
  loaded: false,
  record: (event) => {
    const state = get();
    const index = positions.get(event.sessionId);
    const previous = index === undefined ? undefined : state.events[index];
    if (previous && previous.listenedMs >= event.listenedMs) return;
    if (previous && eventMonth(previous) !== eventMonth(event)) {
      const oldMonth = eventMonth(previous);
      buckets.get(oldMonth)?.delete(event.sessionId);
      dirty.set(oldMonth, ++nextRevision);
    }
    putEvent(event);
    dirty.set(eventMonth(event), ++nextRevision);
    const events = state.events.slice();
    const nextIndex = index ?? events.length;
    events[nextIndex] = event;
    positions.set(event.sessionId, nextIndex);
    statsIndex.record(event);
    set({ events, revision: state.revision + 1 });
  },
}));

function reportPersistenceError(error: unknown): void {
  useListeningStatsStore.setState({ error: error instanceof Error ? error.message : String(error) });
}

const ready = (async () => {
  try {
    const archive = await loadListeningStats();
    const restored: ListeningEvent[] = [];
    for (const [month, contents] of Object.entries(archive.months)) {
      const events = parseListeningEvents(contents);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || events.some(event => eventMonth(event) !== month)) {
        throw new Error(`收听统计月份内容不匹配：${month}`);
      }
      restored.push(...events);
    }
    if (archive.legacy !== null && (!archive.legacy || typeof archive.legacy !== 'object' || !('events' in archive.legacy))) {
      throw new Error('旧收听统计文件结构错误');
    }
    const legacy = parseListeningEvents(archive.legacy === null ? null : (archive.legacy as { events: unknown }).events);
    const merged = parseListeningEvents([...restored, ...legacy, ...useListeningStatsStore.getState().events]);
    buckets.clear(); positions.clear();
    for (const [index, event] of merged.entries()) { putEvent(event); positions.set(event.sessionId, index); }
    for (const event of [...restored, ...legacy]) {
      if (eventMonth(event) !== eventMonth(merged[positions.get(event.sessionId)!])) dirty.set(eventMonth(event), ++nextRevision);
    }
    migrationPending = archive.legacy !== null;
    if (migrationPending) for (const month of buckets.keys()) dirty.set(month, ++nextRevision);
    statsIndex = createListeningStatsIndex(merged);
    useListeningStatsStore.setState(state => ({ events: merged, revision: state.revision + 1, loaded: true }));
  } catch (error) {
    loadError = error instanceof Error ? error : new Error(String(error));
    markNamespaceDegraded('listeningStats');
    reportPersistenceError(loadError);
    useListeningStatsStore.setState({ loaded: true });
  }
})();

export const listeningStatsPersistence: LibraryPersistenceController = {
  ready,
  get loadError() { return loadError; },
  get hasPendingWrites() { return dirty.size > 0 || migrationPending || writing; },
  flush() {
    const task = writes.catch(() => undefined).then(async () => {
      await ready;
      if (loadError) throw loadError;
      writing = true;
      try {
        do {
          for (const [month, revision] of [...dirty]) {
            await saveListeningStatsMonth(month, [...(buckets.get(month)?.values() ?? [])]);
            if (dirty.get(month) === revision) dirty.delete(month);
          }
        } while (dirty.size > 0);
        if (migrationPending) { await libraryReset('listeningStats'); migrationPending = false; }
      } finally { writing = false; }
    });
    writes = task;
    return task;
  },
};
registerLibraryPersistence(listeningStatsPersistence);

let session: ListeningSession | null = null;
let checkpointAt = 0;
let sequence = 0;

function checkpoint(): void {
  if (session?.event.listenedMs) useListeningStatsStore.getState().record(session.event);
}

export function startListeningStats(song: MusicInfo, sample: ListeningSample): void {
  checkpoint();
  if (session) void flushListeningStats().catch(reportPersistenceError);
  const startedAt = Date.now();
  session = createListeningSession(`${startedAt}-${++sequence}-${Math.random().toString(36).slice(2)}`, song, startedAt, sample);
  checkpointAt = sample.at;
}

export function sampleListeningStats(sample: ListeningSample): void {
  if (!session) return;
  const wasPlaying = session.sample.playing;
  session = sampleListeningSession(session, sample);
  if (sample.at - checkpointAt >= LISTENING_CHECKPOINT_MS || (wasPlaying && !sample.playing)) {
    checkpoint();
    checkpointAt = sample.at;
    void flushListeningStats().catch(reportPersistenceError);
  }
}

export function pauseListeningStats(sample: ListeningSample): void {
  if (!session) return;
  session = sampleListeningSession(session, sample);
  checkpoint();
  void flushListeningStats().catch(reportPersistenceError);
}

export function seekListeningStats(sample: ListeningSample): void {
  if (session) session = seekListeningSession(session, sample);
}

export function finishListeningStats(): void {
  checkpoint();
  session = null;
  void flushListeningStats().catch(reportPersistenceError);
}

export async function flushListeningStats(): Promise<void> {
  checkpoint();
  try {
    await listeningStatsPersistence.flush();
    useListeningStatsStore.setState({ error: null });
  } catch (error) {
    reportPersistenceError(error);
    throw error;
  }
}

/** 退出结算使用真实播放器采样，不外推未确认的媒体进度。 */
export function registerListeningStatsSampler(sample: () => ListeningSample): void {
  registerLibraryFlushHook(() => {
    if (session) session = sampleListeningSession(session, sample());
    checkpoint();
  });
}
