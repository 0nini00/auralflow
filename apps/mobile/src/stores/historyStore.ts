import { create } from "zustand";
import { isRemovedSource, type HistoryPlayEntry, type MusicInfo } from "@lx/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logger } from "@/services/logger";
import {
  dayStartOf,
  hasRealPlayedAt,
  historySongKey,
  isSameDay,
  type HistoryEntry,
} from "../services/historyGroupModel";

const HISTORY_KEY = "auralflow.mobile.playHistory";
const HISTORY_TIMESTAMPS_KEY = "auralflow.mobile.playHistoryTimestamps";

// 上限：移动端 AsyncStorage 有体积约束，取 2000 条平衡；与桌面端一致，不按天数过期。
const MAX_HISTORY_ITEMS = 2000;

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
    await get().loadHistory();
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
   * WebDAV 同步覆盖：用远端条目替换本地播放历史。
   * 条目 `playedAt` 为 0 表示「时间未知」：本地补占位时间维持分组，但标记为合成。
   */
  replaceAllHistory: (entries: HistoryEntry[]) => Promise<void>;
  /**
   * WebDAV 同步合并：本地与远端条目按 `key + 本地日` 求并集（同曲不同天各自保留），
   * 同一天保留时间较新的记录；时间未知的歌曲只要存在真实记录就不再保留占位条目。
   */
  mergeHistory: (entries: HistoryEntry[]) => Promise<void>;
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

/**
 * 旧格式迁移 + 通用条目规整：过滤无 id、清理超期、按时间倒序、截断上限，
 * 并把合成时间标记收敛成严格的 `true` / 缺失（落盘数据被改坏时不至于把垃圾值当真）。
 *
 * 排序仍用 `playedAt`（含合成占位时间）——时间未知的条目也能稳定归位；
 * 「这个时间是不是真的」由 `playedAtSynthetic` 单独回答，两者不混用。
 */
function normalizeEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return entries
    .filter((entry) => entry.song?.id)
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
    if (historyHydrated) return;
    historyLoadPromise = (async () => {
      try {
        set({ loading: true, error: null });
        const [[, raw], [, rawTs]] = await AsyncStorage.multiGet([
          HISTORY_KEY,
          HISTORY_TIMESTAMPS_KEY,
        ]);
        const timestamps = parseTimestamps(rawTs);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) throw new Error("播放历史数据格式错误");
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
        const normalized = withoutRemovedSources(normalizeEntries(entries));
        const derived = derive(normalized);
        // 迁移/规整后一次性回写新格式（失败不影响内存态）。
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(normalized)).catch(() => undefined);
        set({
          entries: normalized,
          ...derived,
          loading: false,
          error: null,
        });
        historyHydrated = true;
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : "加载播放历史失败",
        });
        throw error;
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
      // 同一天同一首歌只保留一条（刷新播放时间）；跨天保留多次播放记录。
      const filtered = entries.filter(
        (entry) => !(entry.key === key && isSameDay(entry.playedAt, now)),
      );
      const normalized = normalizeEntries([{ key, song, playedAt: now }, ...filtered]);
      const derived = derive(normalized);
      await AsyncStorage.multiSet([
        [HISTORY_KEY, JSON.stringify(normalized)],
        [HISTORY_TIMESTAMPS_KEY, JSON.stringify(derived.historyTimestamps)],
      ]);
      set({ entries: normalized, ...derived });
    } catch (error) {
      // 写历史失败不能打断播放，但必须留痕：以前是空 catch，真机上写盘失败
      // 只会表现为「历史不动」，日志和界面都无从判断。
      logger.warn("[历史] 写入播放记录失败", error);
    }
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
    } catch (error) {
      logger.warn("[历史] 删除历史记录失败", error);
    }
  },

  replaceAllHistory: async (remoteEntries) => {
    try {
      await ensureHistoryLoaded(get);
      const now = Date.now();
      const entries: HistoryEntry[] = remoteEntries
        .filter((entry) => entry?.song?.id)
        .map((entry, index) => {
          const key = entry.key || historySongKey(entry.song);
          // 云端带了真实播放时间就用；没有（0 / 缺失 / 非法）时只补一个本地占位时间供分组，
          // 并标为合成——统计按时间未知、回传云端写 0，绝不冒充真实时间。
          return isUsableTimestamp(entry.playedAt)
            ? { key, song: entry.song, playedAt: entry.playedAt }
            : { key, song: entry.song, playedAt: now - index, playedAtSynthetic: true };
        });
      const normalized = withoutRemovedSources(normalizeEntries(entries));
      const derived = derive(normalized);
      await AsyncStorage.multiSet([
        [HISTORY_KEY, JSON.stringify(normalized)],
        [HISTORY_TIMESTAMPS_KEY, JSON.stringify(derived.historyTimestamps)],
      ]);
      set({ entries: normalized, ...derived });
    } catch (error) {
      logger.warn("[历史] 覆盖播放历史失败", error);
    }
  },

  mergeHistory: async (remoteEntries) => {
    try {
      await ensureHistoryLoaded(get);
      const { entries: current } = get();
      const now = Date.now();
      // 与桌面端同一口径：真实播放时间按 `key + 本地日` 求并集（同曲不同天各自保留），
      // 同一天保留时间较新的记录；时间未知的歌曲每首最多留一条占位条目。
      const realByDay = new Map<string, HistoryEntry>();
      const unknownByKey = new Map<string, HistoryEntry>();
      const addReal = (entry: HistoryEntry) => {
        const id = `${entry.key}:${dayStartOf(entry.playedAt)}`;
        const previous = realByDay.get(id);
        if (!previous || entry.playedAt > previous.playedAt) realByDay.set(id, entry);
      };
      // 本地合成占位条目优先于远端「时间未知」：本地占位时间还能维持分组。
      for (const entry of current) {
        if (hasRealPlayedAt(entry)) addReal(entry);
        else unknownByKey.set(entry.key, entry);
      }
      for (const entry of remoteEntries) {
        if (!entry?.song?.id) continue;
        const key = entry.key || historySongKey(entry.song);
        if (isUsableTimestamp(entry.playedAt)) {
          addReal({ key, song: entry.song, playedAt: entry.playedAt });
        } else if (!unknownByKey.has(key)) {
          unknownByKey.set(key, { key, song: entry.song, playedAt: now, playedAtSynthetic: true });
        }
      }
      const realKeys = new Set([...realByDay.values()].map((entry) => entry.key));
      const merged = [...realByDay.values()];
      for (const [key, entry] of unknownByKey) {
        if (!realKeys.has(key)) merged.push(entry);
      }
      const normalized = withoutRemovedSources(normalizeEntries(merged));
      const derived = derive(normalized);
      await AsyncStorage.multiSet([
        [HISTORY_KEY, JSON.stringify(normalized)],
        [HISTORY_TIMESTAMPS_KEY, JSON.stringify(derived.historyTimestamps)],
      ]);
      set({ entries: normalized, ...derived });
    } catch (error) {
      // 合并失败必须抛给调用方（WebDAV 同步）：同步据此停在「上传」之前。
      // 以前这里静默吞掉，同步会带着没合并成功的本地历史继续上传，
      // 把云端来自其它设备的历史整份覆盖掉——双端历史于是永远各自为政。
      logger.warn("[历史] 合并云端历史失败", error);
      throw error;
    }
  },
}));
