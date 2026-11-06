import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import { create } from 'zustand';
import { parseListeningEvents, type ListeningEvent } from '@lx/core';
import { logger } from '@/services/logger';

const LEGACY_STORAGE_KEY = 'af-listening-events-v1';
interface NativeListeningStatsStore {
  listMonths: () => Promise<string[]>;
  readMonth: (month: string) => Promise<string | null>;
  writeMonth: (month: string, contents: string) => Promise<void>;
}

function nativeStorage(): NativeListeningStatsStore {
  const native = NativeModules.ListeningStatsStore as NativeListeningStatsStore | undefined;
  if (!native?.listMonths || !native.readMonth || !native.writeMonth) {
    throw new Error('收听统计文件模块不可用，请安装新版应用');
  }
  return native;
}

/** 文件按 UTC 月稳定分桶，显示趋势仍使用设备本地日历日。 */
function eventMonth(event: ListeningEvent): string {
  return new Date(event.startedAt).toISOString().slice(0, 7);
}
interface ListeningStatsState {
  events: ListeningEvent[];
  error: string | null;
  /** 部分月份无法读取时的提示；不影响其它月份继续记录与落盘。 */
  warning: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  record: (event: ListeningEvent) => void;
  flush: () => Promise<void>;
}
let loading: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();
let buckets = new Map<string, Map<string, ListeningEvent>>();
/** 读不出来的月份：既不参与统计，也不允许被新事件覆盖写回。 */
const corruptMonths = new Set<string>();
const dirtyMonths = new Map<string, number>();
let revision = 0;
let legacyPendingRemoval = false;

function currentEvents(): ListeningEvent[] {
  return [...buckets.values()].flatMap(bucket => [...bucket.values()]);
}

function groupEvents(events: ListeningEvent[]): Map<string, Map<string, ListeningEvent>> {
  const grouped = new Map<string, Map<string, ListeningEvent>>();
  for (const event of events) {
    const month = eventMonth(event);
    const bucket = grouped.get(month) ?? new Map<string, ListeningEvent>();
    bucket.set(event.sessionId, event);
    grouped.set(month, bucket);
  }
  return grouped;
}

export function reportListeningStatsError(error: unknown): void {
  useListeningStatsStore.setState({ error: error instanceof Error ? error.message : String(error) });
  logger.error('收听统计保存或读取失败', error);
}

export const useListeningStatsStore = create<ListeningStatsState>((set, get) => ({
  events: [], error: null, warning: null, loaded: false,
  load: async () => {
    if (get().loaded) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        const native = nativeStorage();
        const months = await native.listMonths();
        const restored: ListeningEvent[] = [];
        const skipped: string[] = [];
        for (const month of months) {
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            logger.warn(`跳过命名无效的收听统计月份：${month}`);
            skipped.push(month);
            corruptMonths.add(month);
            continue;
          }
          // 单月损坏（例如首次写入被中断留下的 .new）不能连累其它月份：
          // load 一旦整体失败，flush 每次都会在 await load 处抛错，统计就永久写不进去。
          try {
            const raw = await native.readMonth(month);
            if (raw === null) continue;
            const events = parseListeningEvents(JSON.parse(raw));
            if (events.some(event => eventMonth(event) !== month)) throw new Error(`收听统计月份内容不匹配：${month}`);
            for (const event of events) restored.push(event);
          } catch (error) {
            logger.warn(`跳过无法读取的收听统计月份 ${month}`, error);
            skipped.push(month);
            corruptMonths.add(month);
          }
        }
        const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        const legacyEvents = parseListeningEvents(legacy === null ? null : JSON.parse(legacy));
        // 线性合并读盘期间产生的会话；失败前不修改已加载基线或覆盖文件。
        const merged = parseListeningEvents([...restored, ...legacyEvents, ...currentEvents()]);
        buckets = groupEvents(merged);
        for (const event of legacyEvents) dirtyMonths.set(eventMonth(event), ++revision);
        legacyPendingRemoval = legacy !== null;
        set({
          events: merged,
          loaded: true,
          error: null,
          warning: skipped.length > 0 ? `以下统计月份读取失败，已跳过：${skipped.join('、')}` : null,
        });
      } catch (error) {
        reportListeningStatsError(error);
        throw error;
      } finally { loading = null; }
    })();
    return loading;
  },
  record: event => {
    const month = eventMonth(event);
    // 该月文件读不出来：保留磁盘原样，别用新事件覆盖掉仅存的数据。
    if (corruptMonths.has(month)) return;
    const bucket = buckets.get(month) ?? new Map<string, ListeningEvent>();
    const previous = bucket.get(event.sessionId);
    if (previous && previous.listenedMs >= event.listenedMs) return;
    bucket.set(event.sessionId, event);
    buckets.set(month, bucket);
    dirtyMonths.set(month, ++revision);
    set({ events: currentEvents() });
  },
  flush: () => {
    // 失败由原调用方接收；后续重试可排队，快照在轮到事务时读取。
    const write = writes.catch(() => undefined).then(async () => {
      try {
        await get().load();
        const native = nativeStorage();
        do {
          for (const [month, snapshotRevision] of [...dirtyMonths]) {
            const bucket = buckets.get(month);
            if (!bucket) throw new Error(`收听统计缺少待保存月份：${month}`);
            await native.writeMonth(month, JSON.stringify([...bucket.values()]));
            if (dirtyMonths.get(month) === snapshotRevision) dirtyMonths.delete(month);
          }
          if (legacyPendingRemoval && dirtyMonths.size === 0) {
            await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
            legacyPendingRemoval = false;
          }
        } while (dirtyMonths.size > 0);
        set({ error: null });
      } catch (error) {
        reportListeningStatsError(error);
        throw error;
      }
    });
    writes = write;
    return write;
  },
}));
