import { create } from "zustand";
import {
  dropRemovedSourceEntries,
  mergeWebdavHistory,
  type HistoryPlayEntry,
  type MusicInfo,
} from "@lx/core";
import { attachLibraryPersistence } from "./libraryPersistence";

interface HistoryState {
  history: MusicInfo[];
  /**
   * **内部字段**（不改变对外的 `history: MusicInfo[]` 形状）：`history` 里每条记录的
   * 真实播放时间戳（毫秒），键 = `musicKey`。
   *
   * 只有确实记过时间的条目才有键：升级前落盘的旧数据、云端没带 `playedAt` 的条目
   * 在这里一律缺席，统计时按「时间未知」处理（宁可少一天趋势，也不按数组下标编造时间）。
   */
  playedAtByKey: Record<string, number>;
  add: (music: MusicInfo) => void;
  remove: (key: string) => void;
  clear: () => void;
  replaceAll: (songs: MusicInfo[]) => void;
  /**
   * WebDAV 同步合并：本地与远端历史并集(去重),保留本地顺序,截断上限。
   * `remotePlayedAtByKey` 是云端条目**真实带回来**的时间戳（没有就传空对象/不传）：
   * 带了的用云端值，没带的保留本地已记录的值，两边都没有就留空。
   */
  mergeAll: (songs: MusicInfo[], remotePlayedAtByKey?: Record<string, number>) => void;
  /** 统计适配入口：把 `history` 配上真实时间戳，喂给 core 的 `aggregateListeningStats`。 */
  statsEntries: () => HistoryPlayEntry[];
}

/**
 * 播放历史上限。**必须与移动端一致**（`apps/mobile/src/stores/historyStore.ts` 的
 * `MAX_HISTORY_ITEMS` = 2000）：下载→合并→上传这条链会先按本地上限截断、再把结果写回云端，
 * 所以本地上限只要比移动端小，一次桌面同步就会删掉只存在于云端的记录
 * （曾是 200，最多可删掉 1800 条）。
 *
 * 统计视图会把「上限 N 条」写进文案，所以这里 export 出去，避免 UI 再抄一个常量。
 */
export const MAX_HISTORY = 2000;

/**
 * 历史条目的去重键。与 core 的 `songKey`（`packages/core/src/webdav-merge.ts`）、
 * 移动端的 `historySongKey` 口径一致；WebDAV 解析也要用它，故导出。
 */
export function musicKey(music: MusicInfo): string {
  return `${music.source}:${music.id}`;
}

/**
 * 丢掉来源已被移除的历史条目（本版整体下线了 B 站）。已落盘的数据里仍可能有它们：
 * 新版本里既没有 provider 也点不动，留着只会变成死行，并随 WebDAV 同步在两端来回传。
 */
function withoutRemovedSources(songs: MusicInfo[]): MusicInfo[] {
  const { kept, dropped } = dropRemovedSourceEntries(songs ?? []);
  if (dropped.length > 0) {
    console.warn(`[历史] 已清理 ${dropped.length} 条来源已下线的历史条目`);
  }
  return kept;
}

/** 可用的播放时间戳：正的有限毫秒数。0 / 负数 / NaN / 非数字一律视为「时间未知」。 */
function isUsablePlayedAt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 把时间戳表收敛成「只含 `history` 里仍存在的键」的合法表：
 * 历史被截断 / 删除后不留孤儿键；`local` 先铺底、`remote` 覆盖（同一首歌两边都记过时间时，
 * 以同步文件里带回来的那条记录为准）。
 */
function collectPlayedAt(
  history: MusicInfo[],
  local: Record<string, number> | undefined,
  remote?: Record<string, number>,
): Record<string, number> {
  const keys = new Set(history.map(musicKey));
  const next: Record<string, number> = {};
  for (const [key, playedAt] of Object.entries(local ?? {})) {
    if (isUsablePlayedAt(playedAt) && keys.has(key)) next[key] = playedAt;
  }
  for (const [key, playedAt] of Object.entries(remote ?? {})) {
    if (isUsablePlayedAt(playedAt) && keys.has(key)) next[key] = playedAt;
  }
  return next;
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  history: [],
  playedAtByKey: {},

  add: (music) => {
    if (!music?.id) return;
    const key = musicKey(music);
    // 追加时就地取当前时间：这是本条历史唯一可信的播放时间来源。
    const playedAt = Date.now();
    set((state) => {
      const filtered = state.history.filter((m) => musicKey(m) !== key);
      const history = [music, ...filtered].slice(0, MAX_HISTORY);
      const playedAtByKey = collectPlayedAt(history, state.playedAtByKey);
      playedAtByKey[key] = playedAt;
      return { history, playedAtByKey };
    });
  },

  remove: (key) =>
    set((state) => {
      const history = state.history.filter((m) => musicKey(m) !== key);
      return { history, playedAtByKey: collectPlayedAt(history, state.playedAtByKey) };
    }),

  clear: () => set({ history: [], playedAtByKey: {} }),

  replaceAll: (songs) => {
    const history = songs ?? [];
    set((state) => ({
      history,
      playedAtByKey: collectPlayedAt(history, state.playedAtByKey),
    }));
  },

  mergeAll: (songs, remotePlayedAtByKey) => {
    set((state) => {
      const history = withoutRemovedSources(mergeWebdavHistory(state.history, songs ?? [], MAX_HISTORY));
      return {
        history,
        playedAtByKey: collectPlayedAt(history, state.playedAtByKey, remotePlayedAtByKey),
      };
    });
  },

  statsEntries: () => {
    const { history, playedAtByKey } = get();
    return history.map((song) => {
      const playedAt = playedAtByKey[musicKey(song)];
      return isUsablePlayedAt(playedAt) ? { song, playedAt } : { song };
    });
  },
}));

/**
 * 落盘切片。`playedAtByKey` 是可选的：升级前只写过 `{ history }`，
 * 读回来时时间戳表缺席，那部分历史就只进总数/总时长/榜单，不进趋势。
 */
interface HistoryPersistedSlice {
  history?: MusicInfo[];
  playedAtByKey?: Record<string, number>;
}

export const historyPersistence = attachLibraryPersistence<HistoryState, HistoryPersistedSlice>(useHistoryStore, {
  namespace: "recent",
  pick: (state) => ({ history: state.history, playedAtByKey: state.playedAtByKey }),
  apply: (slice, set) => {
    const history = withoutRemovedSources(slice.history ?? []);
    set({ history, playedAtByKey: collectPlayedAt(history, slice.playedAtByKey) });
  },
});
