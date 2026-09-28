import { create } from "zustand";
import { mergeWebdavHistory, type MusicInfo } from "@lx/core";
import { attachLibraryPersistence } from "./libraryPersistence";

interface HistoryState {
  history: MusicInfo[];
  add: (music: MusicInfo) => void;
  remove: (key: string) => void;
  clear: () => void;
  replaceAll: (songs: MusicInfo[]) => void;
  /** WebDAV 同步合并：本地与远端历史并集(去重),保留本地顺序,截断上限。 */
  mergeAll: (songs: MusicInfo[]) => void;
}

/**
 * 播放历史上限。**必须与移动端一致**（`apps/mobile/src/stores/historyStore.ts` 的
 * `MAX_HISTORY_ITEMS` = 2000）：下载→合并→上传这条链会先按本地上限截断、再把结果写回云端，
 * 所以本地上限只要比移动端小，一次桌面同步就会删掉只存在于云端的记录
 * （曾是 200，最多可删掉 1800 条）。
 */
const MAX_HISTORY = 2000;

function musicKey(music: MusicInfo): string {
  return `${music.source}:${music.id}`;
}

export const useHistoryStore = create<HistoryState>()((set) => ({
  history: [],

  add: (music) => {
    if (!music?.id) return;
    const key = musicKey(music);
    set((state) => {
      const filtered = state.history.filter((m) => musicKey(m) !== key);
      return { history: [music, ...filtered].slice(0, MAX_HISTORY) };
    });
  },

  remove: (key) =>
    set((state) => ({ history: state.history.filter((m) => musicKey(m) !== key) })),

  clear: () => set({ history: [] }),

  replaceAll: (songs) => set({ history: songs ?? [] }),

  mergeAll: (songs) => {
    set((state) => ({
      history: mergeWebdavHistory(state.history, songs ?? [], MAX_HISTORY),
    }));
  },
}));

export const historyPersistence = attachLibraryPersistence<HistoryState, { history: MusicInfo[] }>(useHistoryStore, {
  namespace: "recent",
  pick: (state) => ({ history: state.history }),
  apply: (slice, set) => set({ history: slice.history ?? [] }),
});
