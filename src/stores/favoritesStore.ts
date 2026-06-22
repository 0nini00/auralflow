import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import { attachLibraryPersistence } from "./libraryPersistence";

interface FavoritesState {
  favorites: MusicInfo[];
  isFavorite: (music: MusicInfo) => boolean;
  toggleFavorite: (music: MusicInfo) => void;
  addFavorite: (music: MusicInfo) => void;
  removeFavorite: (music: MusicInfo) => void;
  clearFavorites: () => void;
  replaceAll: (songs: MusicInfo[]) => void;
}

function getMusicKey(music: MusicInfo): string {
  return `${music.source}:${music.id}`;
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
}));

attachLibraryPersistence<FavoritesState, { favorites: MusicInfo[] }>(useFavoritesStore, {
  namespace: "favorites",
  pick: (state) => ({ favorites: state.favorites }),
  apply: (slice, set) => set({ favorites: slice.favorites ?? [] }),
  legacyLocalStorageKey: "auralflow-favorites",
});
