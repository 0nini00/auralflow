import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  historySongKey,
  isSameDay,
  type HistoryEntry,
} from "../services/historyGroupModel";

const HISTORY_KEY = "auralflow.mobile.playHistory";
const HISTORY_TIMESTAMPS_KEY = "auralflow.mobile.playHistoryTimestamps";

// 对齐 lx：上限 5000 条 + 31 天滚动。移动端 AsyncStorage 有体积约束，取 2000 条平衡。
const MAX_HISTORY_ITEMS = 2000;
const MAX_HISTORY_AGE_MS = 31 * 24 * 60 * 60 * 1000;

export interface HistoryState {
  /** 分时间记录的条目（含 playedAt），供分组展示；按播放时间倒序。 */
  entries: HistoryEntry[];
  /** 派生数组：全部歌曲（顺序同 entries），兼容既有消费方（播放/统计/WebDAV）。 */
  history: MusicInfo[];
  /** 歌曲 key（source:id）→ 最近一次播放时间戳，供 WebDAV 同步保留真实播放时间。 */
  historyTimestamps: Record<string, number>;
  loading: boolean;
  error: string | null;
}

interface HistoryActions {
  loadHistory: () => Promise<void>;
  addToHistory: (song: MusicInfo) => Promise<void>;
  clearHistory: () => Promise<void>;
  removeFromHistory: (songId: string, source: string) => Promise<void>;
  /** WebDAV 同步覆盖：用远端历史替换本地播放历史。 */
  replaceAllHistory: (history: MusicInfo[], timestamps?: Record<string, number>) => Promise<void>;
  /** WebDAV 同步合并：本地与远端历史并集，同曲保留播放时间较新的条目。 */
  mergeHistory: (history: MusicInfo[], timestamps?: Record<string, number>) => Promise<void>;
}

type HistoryStore = HistoryState & HistoryActions;

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as { song?: unknown; playedAt?: unknown };
  return item.song != null && typeof item.playedAt === "number";
}

/** 旧格式迁移 + 通用条目规整：过滤无 id、清理超期、按时间倒序、截断上限。 */
function normalizeEntries(entries: HistoryEntry[], now: number): HistoryEntry[] {
  return entries
    .filter((entry) => entry.song?.id && now - entry.playedAt <= MAX_HISTORY_AGE_MS)
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, MAX_HISTORY_ITEMS);
}

/** 由条目派生 history / historyTimestamps。 */
function derive(entries: HistoryEntry[]): {
  history: MusicInfo[];
  historyTimestamps: Record<string, number>;
} {
  const history: MusicInfo[] = [];
  const historyTimestamps: Record<string, number> = {};
  for (const entry of entries) {
    history.push(entry.song);
    historyTimestamps[entry.key] = entry.playedAt;
  }
  return { history, historyTimestamps };
}

function parseTimestamps(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        // 只保留合法数值，避免损坏/异常值泄漏到同步文件的 playedAt
        if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
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
  loading: false,
  error: null,

  loadHistory: async () => {
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
            .map((song, index) => ({
              key: historySongKey(song),
              song,
              playedAt: timestamps[historySongKey(song)] ?? now - index,
            }));
        }
      }
      const normalized = normalizeEntries(entries, Date.now());
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
    }
  },

  addToHistory: async (song: MusicInfo) => {
    try {
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
      set({ entries: [], history: [], historyTimestamps: {} });
    } catch (error) {
      throw error;
    }
  },

  removeFromHistory: async (songId: string, source: string) => {
    try {
      const { entries } = get();
      const key = `${source}:${songId}`;
      const normalized = entries.filter((entry) => entry.key !== key);
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
      const now = Date.now();
      const entries = history
        .filter((music) => music?.id)
        .map((song, index) => {
          const key = historySongKey(song);
          return {
            key,
            song,
            playedAt: timestamps?.[key] ?? now - index,
          };
        });
      const normalized = normalizeEntries(entries, now);
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
      const { entries: current, historyTimestamps } = get();
      const now = Date.now();
      // 时间戳取两侧较新值：远端同步文件可能早于本地最近播放，避免时间回退。
      const mergedTimestamps: Record<string, number> = { ...historyTimestamps };
      for (const [key, value] of Object.entries(timestamps ?? {})) {
        mergedTimestamps[key] = Math.max(mergedTimestamps[key] ?? 0, value);
      }
      const merged = new Map<string, HistoryEntry>();
      for (const song of history) {
        if (!song?.id) continue;
        const key = historySongKey(song);
        merged.set(key, { key, song, playedAt: mergedTimestamps[key] ?? now });
      }
      for (const entry of current) {
        const existing = merged.get(entry.key);
        // 同曲保留播放时间较新的条目（歌曲信息也随之来自较新记录）。
        if (!existing || entry.playedAt > existing.playedAt) merged.set(entry.key, entry);
      }
      const normalized = normalizeEntries([...merged.values()], now);
      const derived = derive(normalized);
      await AsyncStorage.multiSet([
        [HISTORY_KEY, JSON.stringify(normalized)],
        [HISTORY_TIMESTAMPS_KEY, JSON.stringify(derived.historyTimestamps)],
      ]);
      set({ entries: normalized, ...derived });
    } catch {}
  },
}));
