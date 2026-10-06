import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getDownloadedLocalSongs,
  isDownloadedLocalSong,
  pickLocalAudioFiles,
  scanLocalMusic,
  updateLocalMusicMetadata,
} from "../services/localMusicService";
import { buildLocalMusicMetadataUpdate, type LocalMusicMetadataInput } from "@/services/localMusicMetadataModel";

import {
  applyLocalMetadataEdit,
  mergeManualLocalSongs,
  parseLocalSongs,
  reconcileLocalMusic,
  type LocalMusicInfo,
} from "../services/localMusicScanModel";

export const LOCAL_MUSIC_KEY = "auralflow.mobile.localMusic";

export interface LocalMusicState {
  localSongs: LocalMusicInfo[];
  loading: boolean;
  error: string | null;
}

interface LocalMusicActions {
  loadLocalSongs: () => Promise<void>;
  scanMusic: () => Promise<void>;
  /** 手动挑选音频文件并合并进本地曲库（不覆盖已有扫描结果）。 */
  importLocalFiles: () => Promise<{ added: number; total: number }>;
  removeLocalSong: (song: Pick<MusicInfo, "id" | "source">) => Promise<void>;
  updateLocalSongMetadata: (
    song: Pick<MusicInfo, "id" | "source">,
    input: LocalMusicMetadataInput,
  ) => Promise<void>;
  clearLocalMusic: () => Promise<void>;
}

type LocalMusicStore = LocalMusicState & LocalMusicActions;

let localSongsLoadPromise: Promise<void> | null = null;
let localSongsHydrated = false;
let localSongsOperationTail: Promise<void> = Promise.resolve();

function serializeLocalMusicOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = localSongsOperationTail.then(operation);
  // 队列恢复仅用于接纳后续操作；调用方仍接收原始 result 的拒绝，错误不被吞掉。
  localSongsOperationTail = result.then(() => undefined, () => undefined);
  return result;
}

async function ensureLocalSongsLoaded(get: () => LocalMusicStore): Promise<void> {
  if (!localSongsHydrated || localSongsLoadPromise) await get().loadLocalSongs();
}

type LocalSongsUpdate = (songs: LocalMusicInfo[]) => LocalMusicInfo[] | Promise<LocalMusicInfo[]>;

export const useLocalMusicStore = create<LocalMusicStore>((set, get) => {
  // 所有写入共享同一提交边界：读取当前态、变换、落盘、发布内存态不可交错。
  const commitLocalSongs = (update: LocalSongsUpdate, removeStorage = false) => serializeLocalMusicOperation(async () => {
    try {
      const current = get().localSongs;
      const songs = await update(current);
      if (removeStorage) {
        await AsyncStorage.removeItem(LOCAL_MUSIC_KEY);
      } else {
        await AsyncStorage.setItem(LOCAL_MUSIC_KEY, JSON.stringify(songs));
      }
      set({ localSongs: songs, loading: false, error: null });
      return { added: songs.length - current.length, total: songs.length };
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "保存本地音乐失败", loading: false });
      throw error;
    }
  });

  return {
    localSongs: [],
    loading: false,
    error: null,

    loadLocalSongs: async () => {
      if (localSongsLoadPromise) return localSongsLoadPromise;
      localSongsLoadPromise = serializeLocalMusicOperation(async () => {
        try {
          set({ loading: true, error: null });
          const raw = await AsyncStorage.getItem(LOCAL_MUSIC_KEY);
          set({ localSongs: parseLocalSongs(raw), loading: false });
          localSongsHydrated = true;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "加载本地音乐失败", loading: false });
          throw error;
        }
      });
      try {
        await localSongsLoadPromise;
      } finally {
        localSongsLoadPromise = null;
      }
    },

    scanMusic: async () => {
      set({ loading: true, error: null });
      try {
        await ensureLocalSongsLoaded(get);
        set({ loading: true, error: null });
        // 并行查询 MediaStore 与检查已知下载文件，不枚举下载目录或重建孤儿文件索引。
        const [scanned, downloaded] = await Promise.all([
          scanLocalMusic(get().localSongs),
          getDownloadedLocalSongs(get().localSongs),
        ]);
        await commitLocalSongs((songs) => reconcileLocalMusic(songs, [scanned, downloaded]));
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "扫描失败", loading: false });
        throw error;
      }
    },

    importLocalFiles: async () => {
      set({ loading: true, error: null });
      try {
        await ensureLocalSongsLoaded(get);
        set({ loading: true, error: null });
        const picked = await pickLocalAudioFiles();
        return await commitLocalSongs((songs) => mergeManualLocalSongs(songs, picked));
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "导入失败", loading: false });
        throw error;
      }
    },

    removeLocalSong: async (song) => {
      await ensureLocalSongsLoaded(get);
      await commitLocalSongs((songs) => songs.filter(
        (item) => !(String(item.id) === String(song.id) && item.source === song.source),
      ));
    },

    updateLocalSongMetadata: async (song, input) => {
      await ensureLocalSongsLoaded(get);
      const patch = buildLocalMusicMetadataUpdate(input);
      await commitLocalSongs(async (songs) => {
        const current = songs.find((item) => item.id === song.id && item.source === song.source);
        const downloaded = isDownloadedLocalSong(current ?? song);
        // 下载曲编辑只保存在本地曲库；记录字段名，避免刷新时被旧下载元数据覆盖。
        if (!downloaded) await updateLocalMusicMetadata(String(song.id), patch);
        return songs.map((item) => {
          if (String(item.id) !== String(song.id) || item.source !== song.source) return item;
          return downloaded ? applyLocalMetadataEdit(item, patch) : { ...item, ...patch };
        });
      });
    },

    clearLocalMusic: async () => {
      await ensureLocalSongsLoaded(get);
      await commitLocalSongs(() => [], true);
    },
  };
});
