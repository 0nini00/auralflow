import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getDownloadedLocalSongs,
  getLocalMusicFileKey,
  isDownloadedLocalSong,
  pickLocalAudioFiles,
  scanLocalMusic,
  updateLocalMusicMetadata,
  type LocalMusicScanProgress,
} from "../services/localMusicService";
import { buildLocalMusicMetadataUpdate, type LocalMusicMetadataInput } from "@/services/localMusicMetadataModel";

import {
  applyLocalMetadataEdit,
  mergeManualLocalSongs,
  parseLocalSongs,
  reconcileLocalMusic,
  type LocalMusicInfo,
  type LocalMusicScanResult,
  type LocalMusicScanSummary,
} from "../services/localMusicScanModel";

export const LOCAL_MUSIC_KEY = "auralflow.mobile.localMusic";

export interface LocalMusicState {
  localSongs: LocalMusicInfo[];
  loading: boolean;
  error: string | null;
  /** 扫描进行中的 MediaStore 进度；导入或空闲时为 null。 */
  scanProgress: LocalMusicScanProgress | null;
}

interface LocalMusicActions {
  loadLocalSongs: () => Promise<void>;
  scanMusic: () => Promise<LocalMusicScanSummary>;
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
  let scanning: Promise<LocalMusicScanSummary> | null = null;
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
      set({ localSongs: songs, loading: scanning !== null, error: null });
      return { added: songs.length - current.length, total: songs.length };
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "保存本地音乐失败", loading: scanning !== null });
      throw error;
    }
  });

  return {
    localSongs: [],
    loading: false,
    error: null,
    scanProgress: null,

    loadLocalSongs: async () => {
      if (localSongsLoadPromise) return localSongsLoadPromise;
      localSongsLoadPromise = serializeLocalMusicOperation(async () => {
        try {
          set({ loading: true, error: null });
          const raw = await AsyncStorage.getItem(LOCAL_MUSIC_KEY);
          set({ localSongs: parseLocalSongs(raw), loading: scanning !== null });
          localSongsHydrated = true;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "加载本地音乐失败", loading: scanning !== null });
          throw error;
        }
      });
      try {
        await localSongsLoadPromise;
      } finally {
        localSongsLoadPromise = null;
      }
    },

    scanMusic: () => {
      if (scanning) return scanning;
      set({ loading: true, error: null, scanProgress: { scanned: 0, total: 0 } });
      scanning = (async () => {
        let acceptingProgress = true;
        const observeFailure = (task: Promise<LocalMusicScanResult>) => task.catch(error => {
          acceptingProgress = false;
          set({ error: error instanceof Error ? error.message : "扫描失败", scanProgress: null });
          throw error;
        });
        try {
          await ensureLocalSongsLoaded(get);
          const current = get().localSongs;
          // 一支失败后仍等待另一支结算，原生订阅清理完才允许下一轮扫描。
          const results = await Promise.allSettled([
            observeFailure(scanLocalMusic(current, progress => {
              if (acceptingProgress) set({ scanProgress: progress });
            })),
            observeFailure(getDownloadedLocalSongs(current)),
          ]);
          const scans = results.map(result => {
            if (result.status === "rejected") throw result.reason;
            return result.value;
          });
          const summary = await commitLocalSongs(songs => reconcileLocalMusic(songs, scans, getLocalMusicFileKey));
          return { total: summary.total, warnings: scans.flatMap(scan => scan.warnings ?? []) };
        } catch (error) {
          set({ error: error instanceof Error ? error.message : "扫描失败" });
          throw error;
        } finally {
          acceptingProgress = false;
          set({ loading: false, scanProgress: null });
        }
      })().finally(() => { scanning = null; });
      return scanning;
    },

    importLocalFiles: async () => {
      set({ loading: true, error: null });
      try {
        await ensureLocalSongsLoaded(get);
        set({ loading: true, error: null });
        const picked = await pickLocalAudioFiles();
        return await commitLocalSongs((songs) => mergeManualLocalSongs(songs, picked, getLocalMusicFileKey));
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "导入失败", loading: scanning !== null });
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
        if (!downloaded) await updateLocalMusicMetadata(current?.localMediaId ?? String(song.id), patch);
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
