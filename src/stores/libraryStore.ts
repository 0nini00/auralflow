import { create } from 'zustand';

import type { LocalSong } from '../services/localMusicService';

import { LocalMusicService } from '../services/localMusicService';

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



  /** 重新扫描所有已记录的文件夹，同步增删变化 */

  refreshLibrary: () => Promise<{ added: number; removed: number }>;

}

export const useLibraryStore = create<LibraryStore>()((set, get) => ({
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

  refreshLibrary: async () => {
    const { scanPaths, localSongs } = get();
    if (scanPaths.length === 0) return { added: 0, removed: 0 };

    set({ isScanning: true });
    try {
      // 并行重新扫描所有已记录的文件夹
      const results = await Promise.all(
        scanPaths.map((path) => LocalMusicService.scanDirectory(path).catch(() => [] as LocalSong[])),
      );
      const scannedSongs = results.flat();

      // 建立 path → song 映射，用于检测文件是否存在
      const scannedPaths = new Set(scannedSongs.map((s) => s.path));

      // 1) 移除：文件已不在磁盘上的歌曲（仅针对属于 scanPaths 的歌曲）
      //    手动添加的文件（不在任何 scanPath 下）保留不动
      const scanPathPrefixes = scanPaths.map((p) => (p.endsWith('\\') || p.endsWith('/') ? p : p + '\\'));
      const isInScanPath = (song: LocalSong) =>
        scanPathPrefixes.some((prefix) => song.path.startsWith(prefix) || song.path.startsWith(prefix.replace('\\', '/')));

      const existingSongs = localSongs.filter((s) => !isInScanPath(s) || scannedPaths.has(s.path));
      const removed = localSongs.length - existingSongs.length;

      // 2) 新增：扫描到但不在现有列表中的歌曲
      const existingIds = new Set(existingSongs.map((s) => s.id));
      const newSongs = scannedSongs.filter((s) => !existingIds.has(s.id));
      const added = newSongs.length;

      set({ localSongs: [...existingSongs, ...newSongs] });
      return { added, removed };
    } finally {
      set({ isScanning: false });
    }
  },
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
