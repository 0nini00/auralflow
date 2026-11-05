import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { dropRemovedSourceEntries, mergeWebdavSongs, type MusicInfo } from "@lx/core";

import { createSerialTaskQueue } from "@/utils/serialTaskQueue";

/**
 * 本地收藏（"我喜欢"）——对齐桌面端 favoritesStore 语义：
 * 心形按钮把歌曲加入/移出本地收藏列表，不调用任何网易云接口；
 * WebDAV 同步 loveList 与桌面端共用同一数据槽（favorites）。
 */

const FAVORITES_KEY = "auralflow.mobile.favorites.v1";
/** 旧版网易云红心落地的本地列表：首次升级时迁移为本地收藏的种子数据 */
const LEGACY_LIKED_SONGS_KEY = "auralflow.mobile.likedSongs";

/**
 * 丢掉来源已被移除的收藏条目（本版整体下线了 B 站）。已落盘的数据里仍可能有它们：
 * 新版本里既没有 provider 也点不动，留着只会变成死行，并随 WebDAV 同步在两端来回传。
 */
function withoutRemovedSources(songs: MusicInfo[]): MusicInfo[] {
  const { kept, dropped } = dropRemovedSourceEntries(songs ?? []);
  if (dropped.length > 0) {
    console.warn(`[收藏] 已清理 ${dropped.length} 条来源已下线的历史条目`);
  }
  return kept;
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
  await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

function parseFavorites(raw: string | null): MusicInfo[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("收藏数据格式错误");
  return parsed as MusicInfo[];
}

export const useFavoritesStore = create<FavoritesState>((set, get) => {
  const enqueue = createSerialTaskQueue();

  async function hydrateFavorites(): Promise<void> {
    if (get().loaded) return;
    const raw = await AsyncStorage.getItem(FAVORITES_KEY);
    if (raw == null) {
      const legacy = await AsyncStorage.getItem(LEGACY_LIKED_SONGS_KEY);
      if (legacy != null) {
        const favorites = withoutRemovedSources(parseFavorites(legacy));
        await persistFavorites(favorites);
        await AsyncStorage.removeItem(LEGACY_LIKED_SONGS_KEY);
        set({ favorites, loaded: true });
        return;
      }
    }
    set({ favorites: withoutRemovedSources(parseFavorites(raw)), loaded: true });
  }

  function commitFavorites(update: (current: MusicInfo[]) => MusicInfo[]): Promise<void> {
    return enqueue(async () => {
      await hydrateFavorites();
      const current = get().favorites;
      const favorites = update(current);
      if (favorites === current) return;
      await persistFavorites(favorites);
      set({ favorites });
    });
  }

  return ({
  favorites: [],
  loaded: false,

  loadFromStorage: () => enqueue(hydrateFavorites),

  isFavorite: (song) => {
    if (!song) return false;
    const key = songKey(song);
    return get().favorites.some((item) => songKey(item) === key);
  },

  toggleFavorite: (song) => commitFavorites((favorites) => {
    const key = songKey(song);
    return favorites.some((item) => songKey(item) === key)
      ? favorites.filter((item) => songKey(item) !== key)
      : [song, ...favorites];
  }),

  addFavorite: (song) => commitFavorites((favorites) => {
    const key = songKey(song);
    return favorites.some((item) => songKey(item) === key) ? favorites : [song, ...favorites];
  }),

  removeFavorite: (song) => commitFavorites((favorites) => {
    const key = songKey(song);
    const next = favorites.filter((item) => songKey(item) !== key);
    return next.length === favorites.length ? favorites : next;
  }),

  replaceAll: (songs) => commitFavorites(() => withoutRemovedSources(songs)),

  mergeAll: (songs) => commitFavorites((favorites) => withoutRemovedSources(mergeWebdavSongs(favorites, songs))),
  });
});
