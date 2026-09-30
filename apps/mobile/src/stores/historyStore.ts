import { create } from "zustand";
import { isRemovedSource, type HistoryPlayEntry, type MusicInfo } from "@lx/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  hasRealPlayedAt,
  historySongKey,
  isSameDay,
  type HistoryEntry,
} from "../services/historyGroupModel";

const HISTORY_KEY = "auralflow.mobile.playHistory";
const HISTORY_TIMESTAMPS_KEY = "auralflow.mobile.playHistoryTimestamps";

// 对齐 lx：上限 5000 条 + 31 天滚动。移动端 AsyncStorage 有体积约束，取 2000 条平衡。
const MAX_HISTORY_ITEMS = 2000;
const MAX_HISTORY_AGE_MS = 31 * 24 * 60 * 60 * 1000;

// 启动 load* 未完成时用户即写入：串行化加载 + 写入，避免晚到的 load 回滚刚写入的记录。
let historyLoadPromise: Promise<void> | null = null;
let historyHydrated = false;

/** 丢掉来源已被移除的历史条目（本版整体下线了 B 站）。 */
function withoutRemovedSources(entries: HistoryEntry[]): HistoryEntry[] {
  const kept = (entries ?? []).filter((entry) => !isRemovedSource(entry?.song?.source));
  const removed = (entries?.length ?? 0) - kept.length;
  if (removed > 0) {
    console.warn(`[历史] 已清理 ${removed} 条来源已下线的历史条目`);
  }
  return kept;
}

async function ensureHistoryLoaded(get: () => HistoryStore): Promise<void> {
  if (!historyHydrated || historyLoadPromise) {
    try {
      await get().loadHistory();
    } catch {
      // load 失败不阻断写入：在现有内存态上继续
    }
  }
}

export interface HistoryState {
  /** 分时间记录的条目（含 playedAt），供分组展示；按播放时间倒序。 */
  entries: HistoryEntry[];
  /** 派生数组：全部歌曲（顺序同 entries），兼容既有消费方（播放/统计/WebDAV）。 */
  history: MusicInfo[];
  /**
   * 歌曲 key（source:id）→ **真实**播放时间戳；键只覆盖确实记过时间的条目
   * （口径同桌面端 `playedAtByKey`）。合成占位时间不进这张表。
   */
  historyTimestamps: Record<string, number>;
  loading: boolean;
  error: string | null;
  /**
   * 统计适配数组（派生）：条目配上**真实**播放时间；合成占位时间的条目不设 `playedAt`
   * （时间未知）。口径同桌面端 `statsEntries`（`desktop/src/stores/historyStore.ts:134`）：
   * 只进总数 / 总时长 / 榜单，不进按天趋势。
   */
  statsEntries: HistoryPlayEntry[];
}

interface HistoryActions {
  loadHistory: () => Promise<void>;
  addToHistory: (song: MusicInfo) => Promise<void>;
  clearHistory: () => Promise<void>;
  removeFromHistory: (songId: string, source: string, dayStart?: number) => Promise<void>;
  /**
   * WebDAV 同步覆盖：用远端历史替换本地播放历史。
   * `timestamps` 只含云端**真实带回来**的时间戳；缺键的条目按「时间未知」处理，不补假值。
   */
  replaceAllHistory: (history: MusicInfo[], timestamps?: Record<string, number>) => Promise<void>;
  /**
   * WebDAV 同步合并：本地与远端历史并集，同曲优先保留真实播放时间，其次取时间较新的条目。
   * `timestamps` 同上，只含云端真实带回来的时间戳。
   */
  mergeHistory: (history: MusicInfo[], timestamps?: Record<string, number>) => Promise<void>;
}

type HistoryStore = HistoryState & HistoryActions;

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as { song?: unknown; playedAt?: unknown };
  return item.song != null && typeof item.playedAt === "number";
}
/** 可用的**真实**播放时间戳：正的有限毫秒数（0 / 负数 / NaN / 非数字一律算「时间未知」）。 */
function isUsableTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** 同曲条目取舍：真实播放时间优先于合成占位时间，两者同类时取时间较新的那一条。 */
function isBetterEntry(candidate: HistoryEntry, incumbent: HistoryEntry): boolean {
  const candidateReal = hasRealPlayedAt(candidate);
  const incumbentReal = hasRealPlayedAt(incumbent);
  if (candidateReal !== incumbentReal) return candidateReal;
  return candidate.playedAt > incumbent.playedAt;
}

/**
 * 旧格式迁移 + 通用条目规整：过滤无 id、清理超期、按时间倒序、截断上限，
 * 并把合成时间标记收敛成严格的 `true` / 缺失（落盘数据被改坏时不至于把垃圾值当真）。
 *
 * 排序与 31 天窗口仍用 `playedAt`（含合成占位时间）——时间未知的条目不会因此掉出窗口；
 * 「这个时间是不是真的」由 `playedAtSynthetic` 单独回答，两者不混用。
 */
function normalizeEntries(entries: HistoryEntry[], now: number): HistoryEntry[] {
  return entries
    .filter((entry) => entry.song?.id && now - entry.playedAt <= MAX_HISTORY_AGE_MS)
    .map((entry) =>
      entry.playedAtSynthetic === true
        ? { key: entry.key, song: entry.song, playedAt: entry.playedAt, playedAtSynthetic: true }
        : { key: entry.key, song: entry.song, playedAt: entry.playedAt },
    )
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, MAX_HISTORY_ITEMS);
}

/**
 * 由条目派生 history / historyTimestamps / statsEntries。
 *
 * `historyTimestamps` 只收**真实**播放时间（同桌面端 `playedAtByKey`）：合成占位时间不进
 * 这张表，否则它会被 `mergeHistory` 当成「已知播放时间」传播到别的条目乃至云端。
 *
 * `statsEntries` 是 core 统计的入参：合成占位时间的条目**不带 `playedAt`**（时间未知），
 * 只进总数 / 总时长 / 榜单，不进按天趋势。
 */
function derive(entries: HistoryEntry[]): {
  history: MusicInfo[];
  historyTimestamps: Record<string, number>;
  statsEntries: HistoryPlayEntry[];
} {
  const history: MusicInfo[] = [];
  const historyTimestamps: Record<string, number> = {};
  const statsEntries: HistoryPlayEntry[] = [];
  for (const entry of entries) {
    history.push(entry.song);
    if (hasRealPlayedAt(entry)) {
      historyTimestamps[entry.key] = entry.playedAt;
      statsEntries.push({ song: entry.song, playedAt: entry.playedAt });
    } else {
      statsEntries.push({ song: entry.song });
    }
  }
  return { history, historyTimestamps, statsEntries };
}

function parseTimestamps(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        // 这张表只存真实播放时间：0 / 负数 / 损坏值都按「时间未知」丢弃，
        // 避免未知哨兵或异常值被当成真实时间泄漏进同步文件。
        if (isUsableTimestamp(value)) result[key] = value;
      }
      return result;
    }
  } catch {
    // 损坏的存储忽略，退化为空映射
  }
  return {};
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  entries: [],
  history: [],
  historyTimestamps: {},
  statsEntries: [],
  loading: false,
  error: null,

  loadHistory: async () => {
    if (historyLoadPromise) return historyLoadPromise;
    historyLoadPromise = (async () => {
      try {
        set({ loading: true, error: null });
        const [[, raw], [, rawTs]] = await AsyncStorage.multiGet([
          HISTORY_KEY,
          HISTORY_TIMESTAMPS_KEY,
        ]);
        const timestamps = parseTimestamps(rawTs);
        const parsed = raw ? JSON.parse(raw) : [];
        let entries: HistoryEntry[] = [];
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (isHistoryEntry(parsed[0])) {
            entries = parsed as HistoryEntry[];
          } else {
            // 旧格式（去重 MusicInfo[]）：用时间戳 sidecar 重建条目，保证分时间记录可用。
            const now = Date.now();
            entries = (parsed as MusicInfo[])
              .filter((music) => music?.id)
              .map((song, index): HistoryEntry => {
                const key = historySongKey(song);
                const recorded = timestamps[key];
                // sidecar 里有真实播放时间就用；没有（旧数据从没记过时间）才补占位时间并标为合成。
                return isUsableTimestamp(recorded)
                  ? { key, song, playedAt: recorded }
                  : { key, song, playedAt: now - index, playedAtSynthetic: true };
              });
          }
        }
        const normalized = withoutRemovedSources(normalizeEntries(entries, Date.now()));
        const derived = derive(normalized);
        // 迁移/规整后一次性回写新格式（失败不影响内存态）。
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(normalized)).catch(() => undefined);
        set({
          entries: normalized,
          ...derived,
          loading: false,
          error: null,
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "加载播放历史失败",
        });
      } finally {
        historyHydrated = true;
      }
    })();
    try {
      await historyLoadPromise;
    } finally {
      historyLoadPromise = null;
    }
  },

  addToHistory: async (song: MusicInfo) => {
    try {
      await ensureHistoryLoaded(get);
      const { entries } = get();
      const now = Date.now();
      const key = historySongKey(song);
      // 对齐 lx：同一天同一首歌只保留一条（刷新播放时间）；跨天保留多次播放记录。
      const filtered = entries.filter(
        (entry) => !(entry.key === key && isSameDay(entry.playedAt, now)),
      );
      const normalized = normalizeEntries(
        [{ key, song, playedAt: now }, ...filtered],
        now,
      );
      const derived = derive(normalized);
      await AsyncStorage.multiSet([
        [HISTORY_KEY, JSON.stringify(normalized)],
        [HISTORY_TIMESTAMPS_KEY, JSON.stringify(derived.historyTimestamps)],
      ]);
      set({ entries: normalized, ...derived });
    } catch {}
  },

  clearHistory: async () => {
    try {
      await AsyncStorage.multiRemove([HISTORY_KEY, HISTORY_TIMESTAMPS_KEY]);
      set({ entries: [], history: [], historyTimestamps: {}, statsEntries: [] });
    } catch (error) {
      throw error;
    }
  },

  removeFromHistory: async (songId: string, source: string, dayStart?: number) => {
    try {
      await ensureHistoryLoaded(get);
      const { entries } = get();
      const key = `${source}:${songId}`;
      // 带 dayStart（单日视图删除）时只移除该天内的同曲条目；否则保留旧行为（删除全部天的副本）。
      const normalized = entries.filter((entry) => {
        if (entry.key !== key) return true;
        if (dayStart == null) return false;
        return !isSameDay(entry.playedAt, dayStart);
      });
      const derived = derive(normalized);
      await AsyncStorage.multiSet([
        [HISTORY_KEY, JSON.stringify(normalized)],
        [HISTORY_TIMESTAMPS_KEY, JSON.stringify(derived.historyTimestamps)],
      ]);
      set({ entries: normalized, ...derived });
    } catch {}
  },

  replaceAllHistory: async (history, timestamps) => {
    try {
      await ensureHistoryLoaded(get);
      const now = Date.now();
      const entries: HistoryEntry[] = history
        .filter((music) => music?.id)
        .map((song, index) => {
          const key = historySongKey(song);
          const recorded = timestamps?.[key];
          // 云端带了真实播放时间就用；没有（0 / 缺失 / 非法）时只补一个本地占位时间供分组与
          // 31 天窗口使用，并标为合成——统计按时间未知、回传云端写 0，绝不冒充真实时间。
          return isUsableTimestamp(recorded)
            ? { key, song, playedAt: recorded }
            : { key, song, playedAt: now - index, playedAtSynthetic: true };
        });
      const normalized = withoutRemovedSources(normalizeEntries(entries, now));
      const derived = derive(normalized);
      await AsyncStorage.multiSet([
        [HISTORY_KEY, JSON.stringify(normalized)],
        [HISTORY_TIMESTAMPS_KEY, JSON.stringify(derived.historyTimestamps)],
      ]);
      set({ entries: normalized, ...derived });
    } catch {}
  },

  mergeHistory: async (history, timestamps) => {
    try {
      await ensureHistoryLoaded(get);
      const { entries: current, historyTimestamps } = get();
      const now = Date.now();
      // 时间戳取两侧较新值：远端同步文件可能早于本地最近播放，避免时间回退。
      const mergedTimestamps: Record<string, number> = { ...historyTimestamps };
      for (const [key, value] of Object.entries(timestamps ?? {})) {
        // 只接受云端**真实带回来**的合法时间：0 / 负数 / 非法值一律按「时间未知」忽略。
        if (!isUsableTimestamp(value)) continue;
        mergedTimestamps[key] = Math.max(mergedTimestamps[key] ?? 0, value);
      }
      const merged = new Map<string, HistoryEntry>();
      for (const song of history) {
        if (!song?.id) continue;
        const key = historySongKey(song);
        const recorded = mergedTimestamps[key];
        // 云端没带真实时间（或只带了未知哨兵）时不编造：沿用本地内部时间基准维持分组与
        // 31 天窗口，但显式标为合成——统计按时间未知处理、回传云端写 0。
        merged.set(
          key,
          isUsableTimestamp(recorded)
            ? { key, song, playedAt: recorded }
            : { key, song, playedAt: now, playedAtSynthetic: true },
        );
      }
      for (const entry of current) {
        const existing = merged.get(entry.key);
        // 同曲保留较优条目：真实时间优先于合成占位时间（本地旧数据不因下载被降级成未知），
        // 同类时取时间较新的条目，歌曲信息随之来自较新记录。
        if (!existing || isBetterEntry(entry, existing)) merged.set(entry.key, entry);
      }
      const normalized = withoutRemovedSources(normalizeEntries([...merged.values()], now));
      const derived = derive(normalized);
      await AsyncStorage.multiSet([
        [HISTORY_KEY, JSON.stringify(normalized)],
        [HISTORY_TIMESTAMPS_KEY, JSON.stringify(derived.historyTimestamps)],
      ]);
      set({ entries: normalized, ...derived });
    } catch {}
  },
}));
