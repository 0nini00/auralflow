import {
  createListeningSession, LISTENING_CHECKPOINT_MS, parseListeningEvents,
  sampleListeningSession, seekListeningSession, upsertListeningEvent,
  type ListeningEvent, type ListeningSample, type ListeningSession, type MusicInfo,
} from '@lx/core';
import { attachLibraryPersistence, createLibraryStore, registerLibraryFlushHook } from './libraryPersistence';

interface ListeningStatsState {
  events: ListeningEvent[];
  error: string | null;
  /** 磁盘水合完成前不要渲染“还没有播放记录”，否则冷启动会先闪一次空态。 */
  loaded: boolean;
  record: (event: ListeningEvent) => void;
}
export const useListeningStatsStore = createLibraryStore<ListeningStatsState>((set) => ({
  events: [],
  error: null,
  loaded: false,
  record: (event) => set((state) => ({ events: upsertListeningEvent(state.events, event) })),
}));

export const listeningStatsPersistence = attachLibraryPersistence<ListeningStatsState, { events: unknown }>(useListeningStatsStore, {
  namespace: 'listeningStats',
  pick: ({ events }) => ({ events }),
  shouldPersist: (state, previous) => state.events !== previous.events,
  apply: (slice, set) => set({ events: parseListeningEvents(slice.events) }),
});

function reportPersistenceError(error: unknown): void {
  useListeningStatsStore.setState({ error: error instanceof Error ? error.message : String(error) });
}

void listeningStatsPersistence.ready.then(() => {
  if (listeningStatsPersistence.loadError) reportPersistenceError(listeningStatsPersistence.loadError);
  useListeningStatsStore.setState({ loaded: true });
});

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
