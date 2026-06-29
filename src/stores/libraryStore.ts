import { create } from "zustand";
import type { LocalSong } from "../services/localMusicService";
import { LocalMusicService } from "../services/localMusicService";
import { attachLibraryPersistence } from "./libraryPersistence";
import { mergeLibraryRefreshResults, type LibraryScanResult } from "./libraryRefreshModel";

interface LibraryStore {
  localSongs: LocalSong[];
  scanPaths: string[];
  isScanning: boolean;
  setSongs: (songs: LocalSong[]) => void;
  addSongs: (songs: LocalSong[]) => void;
  updateSong: (id: string, patch: Partial<LocalSong>) => void;
  removeSong: (id: string) => void;
  clearLibrary: () => void;
  resetLibrary: () => void;
  addScanPath: (path: string) => void;
  removeScanPath: (path: string) => void;
  setScanning: (isScanning: boolean) => void;
  refreshLibrary: () => Promise<{ added: number; removed: number; failedPaths: string[] }>;
}

export const useLibraryStore = create<LibraryStore>()((set, get) => ({
  localSongs: [],
  scanPaths: [],
  isScanning: false,

  setSongs: (songs) => set({ localSongs: songs }),

  addSongs: (songs) =>
    set((state) => {
      const existingIds = new Set(state.localSongs.map((song) => song.id));
      const newSongs = songs.filter((song) => !existingIds.has(song.id));
      return { localSongs: [...state.localSongs, ...newSongs] };
    }),

  updateSong: (id, patch) =>
    set((state) => ({
      localSongs: state.localSongs.map((song) => (song.id === id ? { ...song, ...patch } : song)),
    })),

  removeSong: (id) =>
    set((state) => ({
      localSongs: state.localSongs.filter((song) => song.id !== id),
    })),

  clearLibrary: () => set({ localSongs: [] }),
  resetLibrary: () => set({ localSongs: [], scanPaths: [] }),

  addScanPath: (path) =>
    set((state) => {
      if (state.scanPaths.includes(path)) return state;
      return { scanPaths: [...state.scanPaths, path] };
    }),

  removeScanPath: (path) =>
    set((state) => ({
      scanPaths: state.scanPaths.filter((item) => item !== path),
    })),

  setScanning: (isScanning) => set({ isScanning }),

  refreshLibrary: async () => {
    const { scanPaths, localSongs } = get();
    if (scanPaths.length === 0) return { added: 0, removed: 0, failedPaths: [] };

    set({ isScanning: true });
    try {
      const scanResults: LibraryScanResult[] = await Promise.all(
        scanPaths.map(async (path) => {
          try {
            return { path, ok: true, songs: await LocalMusicService.scanDirectory(path) };
          } catch (error) {
            return { path, ok: false, error };
          }
        }),
      );

      const result = mergeLibraryRefreshResults({
        scanPaths,
        localSongs,
        scanResults,
      });
      set({ localSongs: result.songs });
      return {
        added: result.added,
        removed: result.removed,
        failedPaths: result.failedPaths,
      };
    } finally {
      set({ isScanning: false });
    }
  },
}));

attachLibraryPersistence<LibraryStore, { localSongs: LocalSong[]; scanPaths: string[] }>(useLibraryStore, {
  namespace: "library",
  pick: (state) => ({ localSongs: state.localSongs, scanPaths: state.scanPaths }),
  apply: (slice, set) =>
    set({
      localSongs: slice.localSongs ?? [],
      scanPaths: slice.scanPaths ?? [],
    }),
  legacyLocalStorageKey: "library-storage",
});
