import { create } from "zustand";
import { dropRemovedSourceEntries, mergeWebdavSongs, type MusicInfo } from "@lx/core";
import { attachLibraryPersistence } from "./libraryPersistence";

interface FavoritesState {
  favorites: MusicInfo[];
  isFavorite: (music: MusicInfo) => boolean;
  toggleFavorite: (music: MusicInfo) => void;
  addFavorite: (music: MusicInfo) => void;
  removeFavorite: (music: MusicInfo) => void;
  clearFavorites: () => void;
  replaceAll: (songs: MusicInfo[]) => void;
  /** WebDAV 同步合并：本地与远端收藏并集(去重)。 */
  mergeAll: (songs: MusicInfo[]) => void;
}

function getMusicKey(music: MusicInfo): string {
  return `${music.source}:${music.id}`;
}

/**
 * 丢掉来源已被移除的历史条目（本版整体下线了 B 站）。已落盘的数据里仍可能有它们：
 * 新版本里既没有 provider 也点不动，留着只会变成死行，并随 WebDAV 同步在两端来回传。
 */
function withoutRemovedSources(songs: MusicInfo[]): MusicInfo[] {
  const { kept, dropped } = dropRemovedSourceEntries(songs ?? []);
  if (dropped.length > 0) {
    console.warn(`[收藏] 已清理 ${dropped.length} 条来源已下线的历史条目`);
  }
  return kept;
}

export const useFavoritesStore = create<FavoritesState>()((set, get) => ({
  favorites: [],

  isFavorite: (music) => {
    const key = getMusicKey(music);
    return get().favorites.some((m) => getMusicKey(m) === key);
  },

  toggleFavorite: (music) => {
    if (get().isFavorite(music)) {
      get().removeFavorite(music);
    } else {
      get().addFavorite(music);
    }
  },

  addFavorite: (music) => {
    set((state) => {
      const key = getMusicKey(music);
      if (state.favorites.some((m) => getMusicKey(m) === key)) {
        return state;
      }
      return {
        favorites: [music, ...state.favorites],
      };
    });
  },

  removeFavorite: (music) => {
    set((state) => {
      const key = getMusicKey(music);
      return {
        favorites: state.favorites.filter((m) => getMusicKey(m) !== key),
      };
    });
  },

  clearFavorites: () => {
    set({ favorites: [] });
  },

  replaceAll: (songs) => {
    set({ favorites: songs ?? [] });
  },

  mergeAll: (songs) => {
    set((state) => ({
      favorites: withoutRemovedSources(mergeWebdavSongs(state.favorites, songs ?? [])),
    }));
  },
}));

export const favoritesPersistence = attachLibraryPersistence<FavoritesState, { favorites: MusicInfo[] }>(useFavoritesStore, {
  namespace: "favorites",
  pick: (state) => ({ favorites: state.favorites }),
  apply: (slice, set) => set({ favorites: withoutRemovedSources(slice.favorites ?? []) }),
  legacyLocalStorageKey: "auralflow-favorites",
});
