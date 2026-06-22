import { create } from 'zustand';
import type { LocalSong } from '../services/localMusicService';
import { attachLibraryPersistence } from './libraryPersistence';

interface LibraryStore {
  localSongs: LocalSong[];
  scanPaths: string[];
  isScanning: boolean;

  setSongs: (songs: LocalSong[]) => void;
  addSongs: (songs: LocalSong[]) => void;
  updateSong: (id: string, patch: Partial<LocalSong>) => void;
  removeSong: (id: string) => void;
  clearLibrary: () => void;

  addScanPath: (path: string) => void;
  removeScanPath: (path: string) => void;

  setScanning: (isScanning: boolean) => void;
}

export const useLibraryStore = create<LibraryStore>()((set) => ({
  localSongs: [],
  scanPaths: [],
  isScanning: false,

  setSongs: (songs) => set({ localSongs: songs }),

  addSongs: (songs) =>
    set((state) => {
      const existingIds = new Set(state.localSongs.map((s) => s.id));
      const newSongs = songs.filter((s) => !existingIds.has(s.id));
      return { localSongs: [...state.localSongs, ...newSongs] };
    }),

  updateSong: (id, patch) =>
    set((state) => ({
      localSongs: state.localSongs.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })),

  removeSong: (id) =>
    set((state) => ({
      localSongs: state.localSongs.filter((s) => s.id !== id),
    })),

  clearLibrary: () => set({ localSongs: [] }),

  addScanPath: (path) =>
    set((state) => {
      if (state.scanPaths.includes(path)) return state;
      return { scanPaths: [...state.scanPaths, path] };
    }),

  removeScanPath: (path) =>
    set((state) => ({
      scanPaths: state.scanPaths.filter((p) => p !== path),
    })),

  setScanning: (isScanning) => set({ isScanning }),
}));

attachLibraryPersistence<
  LibraryStore,
  { localSongs: LocalSong[]; scanPaths: string[] }
>(useLibraryStore, {
  namespace: 'library',
  pick: (state) => ({ localSongs: state.localSongs, scanPaths: state.scanPaths }),
  apply: (slice, set) =>
    set({
      localSongs: slice.localSongs ?? [],
      scanPaths: slice.scanPaths ?? [],
    }),
  legacyLocalStorageKey: 'library-storage',
});
