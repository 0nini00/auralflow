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

export const LOCAL_MUSIC_KEY = "auralflow.mobile.localMusic";

export interface LocalMusicState {
  localSongs: MusicInfo[];
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

function songKey(song: Pick<MusicInfo, "id" | "source">): string {
  return `${song.source}:${song.id}`;
}

function mergeLocalSongs(existing: MusicInfo[], incoming: MusicInfo[]): MusicInfo[] {
  const seen = new Set(existing.map(songKey));
  const merged = [...existing];
  for (const song of incoming) {
    const key = songKey(song);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(song);
  }
  return merged;
}

type LocalMusicStore = LocalMusicState & LocalMusicActions;

function parseLocalSongs(raw: string | null): MusicInfo[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("本地音乐数据格式错误");
  return parsed as MusicInfo[];
}

async function persistLocalSongs(songs: MusicInfo[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_MUSIC_KEY, JSON.stringify(songs));
}

export const useLocalMusicStore = create<LocalMusicStore>((set) => ({
  localSongs: [],
  loading: false,
  error: null,

  loadLocalSongs: async () => {
    try {
      set({ loading: true, error: null });
      const raw = await AsyncStorage.getItem(LOCAL_MUSIC_KEY);
      set({ localSongs: parseLocalSongs(raw), loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载本地音乐失败";
      set({ error: message, loading: false });
      throw error;
    }
  },

  scanMusic: async () => {
    set({ loading: true, error: null });
    try {
      // MediaStore 不索引应用私有下载目录：并行扫描系统媒体库与应用下载目录，
      // 合并后再落盘——「扫描/刷新」后下载完成的歌曲才能出现在本地曲库
      const [scanned, downloaded] = await Promise.all([
        scanLocalMusic(),
        getDownloadedLocalSongs(),
      ]);
      const songs = mergeLocalSongs(scanned, downloaded);
      await persistLocalSongs(songs);
      set({ localSongs: songs, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "扫描失败";
      set({ error: message, loading: false });
      throw error;
    }
  },

  importLocalFiles: async () => {
    set({ loading: true, error: null });
    try {
      const picked = await pickLocalAudioFiles();
      let added = 0;
      let total = 0;
      let nextSongs: MusicInfo[] = [];
      set((state) => {
        const before = state.localSongs.length;
        nextSongs = mergeLocalSongs(state.localSongs, picked);
        added = nextSongs.length - before;
        total = nextSongs.length;
        return { localSongs: nextSongs, loading: false, error: null };
      });
      await persistLocalSongs(nextSongs);
      return { added, total };
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
      set({ error: message, loading: false });
      throw error;
    }
  },

  removeLocalSong: async (song) => {
    let nextSongs: MusicInfo[] = [];
    set((state) => {
      nextSongs = state.localSongs.filter(
        (item) => !(String(item.id) === String(song.id) && item.source === song.source),
      );
      return { localSongs: nextSongs, error: null };
    });
    await persistLocalSongs(nextSongs);
  },

  updateLocalSongMetadata: async (song, input) => {
    const patch = buildLocalMusicMetadataUpdate(input);
    try {
      // 下载目录入库的歌曲不在 MediaStore 里，没有可写回的媒体 id：仅更新本地列表
      if (!isDownloadedLocalSong(song)) {
        await updateLocalMusicMetadata(String(song.id), patch);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "写回文件标签失败";
      set({ error: message });
      throw error;
    }
    let nextSongs: MusicInfo[] = [];
    set((state) => {
      nextSongs = state.localSongs.map((item) => (
        String(item.id) === String(song.id) && item.source === song.source
          ? { ...item, ...patch }
          : item
      ));
      return { localSongs: nextSongs, error: null };
    });
    await persistLocalSongs(nextSongs);
  },

  clearLocalMusic: async () => {
    await AsyncStorage.removeItem(LOCAL_MUSIC_KEY);
    set({ localSongs: [], error: null });
  },
}));
