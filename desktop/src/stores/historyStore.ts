import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
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

const MAX_HISTORY = 200;

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
    set((state) => {
      const seen = new Set<string>(state.history.map(musicKey));
      const merged = [...state.history];
      for (const song of songs ?? []) {
        if (!song?.source || !song?.id) continue;
        const key = musicKey(song);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(song);
      }
      return { history: merged.slice(0, MAX_HISTORY) };
    });
  },
}));

attachLibraryPersistence<HistoryState, { history: MusicInfo[] }>(useHistoryStore, {
  namespace: "recent",
  pick: (state) => ({ history: state.history }),
  apply: (slice, set) => set({ history: slice.history ?? [] }),
});
