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

/** Monotonic token: only the latest refresh may write results / clear isScanning. */
let libraryRefreshToken = 0;

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
    const { scanPaths } = get();
    if (scanPaths.length === 0) return { added: 0, removed: 0, failedPaths: [] };

    // Only the latest refresh may write results / clear isScanning
    const token = ++libraryRefreshToken;
    set({ isScanning: true });
    try {
      const pathsSnapshot = [...get().scanPaths];
      const scanResults: LibraryScanResult[] = await Promise.all(
        pathsSnapshot.map(async (path) => {
          try {
            return { path, ok: true as const, songs: await LocalMusicService.scanDirectory(path) };
          } catch (error) {
            return { path, ok: false as const, error };
          }
        }),
      );

      if (token !== libraryRefreshToken) {
        return { added: 0, removed: 0, failedPaths: [] };
      }

      // Re-read localSongs at merge time so mid-scan edits are not blindly clobbered
      const { localSongs } = get();
      const result = mergeLibraryRefreshResults({
        scanPaths: pathsSnapshot,
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
      if (token === libraryRefreshToken) {
        set({ isScanning: false });
      }
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
