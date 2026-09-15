import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { mergeWebdavSongs, type MusicInfo } from "@lx/core";

import { healCorruptStorage } from "@/utils/storageSelfHeal";

/**
 * 本地收藏（"我喜欢"）——对齐桌面端 favoritesStore 语义：
 * 心形按钮把歌曲加入/移出本地收藏列表，不调用任何网易云接口；
 * WebDAV 同步 loveList 与桌面端共用同一数据槽（favorites）。
 */

const FAVORITES_KEY = "auralflow.mobile.favorites.v1";
/** 旧版网易云红心落地的本地列表：首次升级时迁移为本地收藏的种子数据 */
const LEGACY_LIKED_SONGS_KEY = "auralflow.mobile.likedSongs";

// 启动 load* 未完成时用户即写入：串行化加载 + 写入，避免晚到的 load 回滚刚写入的记录。
let favoritesLoadPromise: Promise<void> | null = null;
let favoritesHydrated = false;

async function ensureFavoritesLoaded(get: () => FavoritesState): Promise<void> {
  if (!favoritesHydrated || favoritesLoadPromise) {
    try {
      await get().loadFromStorage();
    } catch {
      // load 失败不阻断写入：在现有内存态上继续
    }
  }
}

interface FavoritesState {
  favorites: MusicInfo[];
  loaded: boolean;
  loadFromStorage: () => Promise<void>;
  isFavorite: (song: Pick<MusicInfo, "source" | "id"> | null | undefined) => boolean;
  toggleFavorite: (song: MusicInfo) => Promise<void>;
  addFavorite: (song: MusicInfo) => Promise<void>;
  removeFavorite: (song: Pick<MusicInfo, "source" | "id">) => Promise<void>;
  replaceAll: (songs: MusicInfo[]) => Promise<void>;
  /** WebDAV 下载合并：与远端 loveList 取并集（对齐桌面端 mergeAll） */
  mergeAll: (songs: MusicInfo[]) => Promise<void>;
}

function songKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

async function persistFavorites(favorites: MusicInfo[]): Promise<void> {
  try {
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch (error) {
    console.error("[favorites] 收藏列表写盘失败", error);
  }
}

async function parseFavorites(raw: string | null): Promise<MusicInfo[]> {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("收藏数据格式错误");
  return parsed as MusicInfo[];
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: [],
  loaded: false,

  loadFromStorage: async () => {
    if (favoritesLoadPromise) return favoritesLoadPromise;
    favoritesLoadPromise = (async () => {
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(FAVORITES_KEY);
        if (raw == null) {
          // 首次升级：把旧版网易云红心的本地列表迁移为收藏种子（旧键随后清除）
          const legacy = await AsyncStorage.getItem(LEGACY_LIKED_SONGS_KEY);
          if (legacy) {
            const seeded = await parseFavorites(legacy).catch(() => []);
            await persistFavorites(seeded);
            await AsyncStorage.removeItem(LEGACY_LIKED_SONGS_KEY).catch(() => undefined);
            set({ favorites: seeded, loaded: true });
            return;
          }
        }
        const favorites = await parseFavorites(raw);
        set({ favorites, loaded: true });
      } catch (error) {
        console.error("[favorites] 收藏数据损坏，已备份并重建空列表", error);
        await healCorruptStorage(FAVORITES_KEY, raw);
        set({ favorites: [], loaded: true });
      } finally {
        favoritesHydrated = true;
      }
    })();
    try {
      await favoritesLoadPromise;
    } finally {
      favoritesLoadPromise = null;
    }
  },

  isFavorite: (song) => {
    if (!song) return false;
    const key = songKey(song);
    return get().favorites.some((item) => songKey(item) === key);
  },

  toggleFavorite: async (song) => {
    await ensureFavoritesLoaded(get);
    if (get().isFavorite(song)) {
      await get().removeFavorite(song);
    } else {
      await get().addFavorite(song);
    }
  },

  addFavorite: async (song) => {
    await ensureFavoritesLoaded(get);
    const key = songKey(song);
    if (get().favorites.some((item) => songKey(item) === key)) return;
    // 以当前完整歌曲对象为准（含封面/歌手等元数据），队列里的旧对象引用不影响
    const favorites = [song, ...get().favorites];
    set({ favorites });
    void persistFavorites(favorites);
  },

  removeFavorite: async (song) => {
    await ensureFavoritesLoaded(get);
    const key = songKey(song);
    const favorites = get().favorites.filter((item) => songKey(item) !== key);
    if (favorites.length === get().favorites.length) return;
    set({ favorites });
    void persistFavorites(favorites);
  },

  replaceAll: async (songs) => {
    await ensureFavoritesLoaded(get);
    set({ favorites: songs });
    void persistFavorites(songs);
  },

  mergeAll: async (songs) => {
    await ensureFavoritesLoaded(get);
    const merged = mergeWebdavSongs(get().favorites, songs);
    set({ favorites: merged });
    await persistFavorites(merged);
  },
}));
