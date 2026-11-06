import {
  HISTORY_MAX_ENTRIES,
  addHistoryEntry,
  historyEntryKey,
  historySongs,
  isRemovedSource,
  isUsablePlayedAt,
  mergeHistoryEntries,
  normalizeHistoryEntries,
  toHistoryPlayEntries,
  type HistoryEntry,
  type HistoryPlayEntry,
  type MusicInfo,
} from "@lx/core";
import { attachLibraryPersistence, createLibraryStore } from "./libraryPersistence";

/**
 * 播放历史：**按天条目**存储（同一天同一首歌一条，跨天保留多次），
 * 与移动端 `apps/mobile/src/stores/historyStore.ts` 的 `entries` 同口径。
 *
 * `history` 是从条目派生的唯一歌曲列表（最近优先），只为「最近播放」封面/计数等
 * 既有入口保留，不参与时间视图；时间视图一律读 `entries`。
 */
interface HistoryState {
  entries: HistoryEntry[];
  history: MusicInfo[];
  add: (music: MusicInfo) => void;
  /** 删除某首歌的全部历史（所有天）。单日删除请按 key + 天过滤后走 replaceAll。 */
  remove: (key: string) => void;
  clear: () => void;
  replaceAll: (entries: HistoryEntry[]) => void;
  /** WebDAV 同步合并：本地与远端条目按 key + 本地日求并集。 */
  mergeAll: (entries: HistoryEntry[]) => void;
  /** 统计适配入口：把条目转成 core 统计入参（时间未知的条目不填 playedAt）。 */
  statsEntries: () => HistoryPlayEntry[];
}

/**
 * 播放历史上限。保留策略在 core（最近 365 天 / 最多 4000 条 / 按整天裁剪），
 * 双端共用同一个常量，避免一端比另一端先截断后把云端数据删掉。
 */
export const MAX_HISTORY = HISTORY_MAX_ENTRIES;

/** 历史条目的去重键。与 core 的 `songKey`、移动端 `historySongKey` 口径一致。 */
export function musicKey(music: MusicInfo): string {
  return historyEntryKey(music);
}

/** 丢掉来源已被移除的历史条目（新版本里既没有 provider 也点不动，留着只会变成死行）。 */
function withoutRemovedSources(entries: HistoryEntry[]): HistoryEntry[] {
  const kept = entries.filter((entry) => !isRemovedSource(entry.song.source));
  if (kept.length !== entries.length) {
    console.warn(`[历史] 已清理 ${entries.length - kept.length} 条来源已下线的历史条目`);
  }
  return kept;
}

export const useHistoryStore = createLibraryStore<HistoryState>()((set, get) => ({
  entries: [],
  history: [],

  add: (music) => {
    if (!music?.id) return;
    set((state) => {
      const entries = withoutRemovedSources(addHistoryEntry(state.entries, music));
      return { entries, history: historySongs(entries) };
    });
  },

  remove: (key) =>
    set((state) => {
      const entries = state.entries.filter((entry) => entry.key !== key);
      return { entries, history: historySongs(entries) };
    }),

  clear: () => set({ entries: [], history: [] }),

  replaceAll: (entries) => {
    const normalized = withoutRemovedSources(normalizeHistoryEntries(entries));
    set({ entries: normalized, history: historySongs(normalized) });
  },

  mergeAll: (entries) => {
    set((state) => {
      const merged = withoutRemovedSources(mergeHistoryEntries(state.entries, entries));
      return { entries: merged, history: historySongs(merged) };
    });
  },

  statsEntries: () => toHistoryPlayEntries(get().entries),
}));

/**
 * 落盘切片：
 * - 新格式只写 `entries`；
 * - 旧格式 `{ history, playedAtByKey }` 读回时就地迁移成条目（每个 key 一条，
 *   有真实时间的用真实时间，没有的标 0 = 时间未知，绝不按数组下标编造时间）。
 */
interface HistoryPersistedSlice {
  entries?: unknown;
  history?: MusicInfo[];
  playedAtByKey?: Record<string, number>;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as { key?: unknown; song?: unknown; playedAt?: unknown };
  if (typeof item.key !== "string" || !item.key) return false;
  if (!item.song || typeof item.song !== "object") return false;
  const song = item.song as { id?: unknown };
  if (typeof song.id !== "string" || !song.id) return false;
  return typeof item.playedAt === "number" && Number.isFinite(item.playedAt);
}

function readPersistedEntries(slice: HistoryPersistedSlice): HistoryEntry[] {
  if (Array.isArray(slice.entries)) {
    return slice.entries
      .filter(isHistoryEntry)
      .map((entry) => ({ key: entry.key, song: entry.song, playedAt: isUsablePlayedAt(entry.playedAt) ? entry.playedAt : 0 }));
  }
  const playedAtByKey = slice.playedAtByKey ?? {};
  return (slice.history ?? [])
    .filter((song) => song?.id)
    .map((song) => {
      const key = musicKey(song);
      const recorded = playedAtByKey[key];
      return { key, song, playedAt: isUsablePlayedAt(recorded) ? recorded : 0 };
    });
}

/** 每个 key 最后一次真实播放时间；只给旧版本回退读取用。 */
function lastPlayedAtByKey(entries: readonly HistoryEntry[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of entries) {
    if (!isUsablePlayedAt(entry.playedAt)) continue;
    result[entry.key] = Math.max(result[entry.key] ?? 0, entry.playedAt);
  }
  return result;
}

export const historyPersistence = attachLibraryPersistence<HistoryState, HistoryPersistedSlice>(useHistoryStore, {
  namespace: "recent",
  // entries 是新格式的唯一真相源；同时写回旧字段，降级到旧版本时不至于把本地历史读成空。
  pick: (state) => ({
    entries: state.entries,
    history: state.history,
    playedAtByKey: lastPlayedAtByKey(state.entries),
  }),
  apply: (slice, set) => {
    const entries = withoutRemovedSources(normalizeHistoryEntries(readPersistedEntries(slice)));
    set({ entries, history: historySongs(entries) });
  },
});
