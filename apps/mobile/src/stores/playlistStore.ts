import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WyPlaylistInfo } from "../services/wyPlaylistService";
import { getTxPlaylistDetail } from "../services/txPlaylistService";
import {
  mergeWebdavCloudPlaylists,
  mergeWebdavLocalPlaylists,
  type MusicInfo,
} from "@lx/core";
import { useAccountStore } from "./accountStore";
import { LatestRequestGate } from "@/services/latestRequestGate";
import { healCorruptStorage } from "@/utils/storageSelfHeal";
import type { CreateLocalPlaylistInput, CreateLocalPlaylistWithSongInput, CreateLocalPlaylistWithSongsInput, LocalPlaylist } from "../services/localPlaylistModel";
import {
  addSongsToLocalPlaylist as addSongsToLocalPlaylistModel,
  addSongToLocalPlaylist as addSongToLocalPlaylistModel,
  createLocalPlaylist as createLocalPlaylistModel,
  createLocalPlaylistWithSongs as createLocalPlaylistWithSongsModel,
  createLocalPlaylistWithSong as createLocalPlaylistWithSongModel,
  deleteLocalPlaylist as deleteLocalPlaylistModel,
  duplicateLocalPlaylist as duplicateLocalPlaylistModel,
  type DuplicateLocalPlaylistOptions,
  removeSongFromLocalPlaylist as removeSongFromLocalPlaylistModel,
  renameLocalPlaylist as renameLocalPlaylistModel,
  updateLocalPlaylistInfo as updateLocalPlaylistInfoModel,
  type UpdateLocalPlaylistInfoInput,
} from "../services/localPlaylistModel";
import {
  addPlaylistTracks,
  getUserPlaylists,
  getPlaylistDetail,
  removePlaylistTracks,
  subscribePlaylist,
  createWyPlaylist as createWyPlaylistApi,
  updateWyPlaylistInfo as updateWyPlaylistInfoApi,
  deleteWyPlaylist as deleteWyPlaylistApi,
} from "../services/wyPlaylistService";

export interface PlaylistState {
  playlists: WyPlaylistInfo[];
  currentPlaylist: WyPlaylistInfo | null;
  currentPlaylistSongs: MusicInfo[];
  localPlaylists: LocalPlaylist[];
  loading: boolean;
  error: string | null;
}

interface PlaylistActions {
  fetchPlaylists: (userId: string) => Promise<void>;
  /** 新建网易云自建歌单成功后刷新歌单列表。 */
  createWyPlaylist: (name: string, description?: string) => Promise<void>;
  /** 编辑网易云自建歌单（名称/简介），成功后更新本地歌单缓存。 */
  updateWyPlaylistInfo: (playlistId: string, changes: { name?: string; description?: string }) => Promise<void>;
  /** 删除网易云自建歌单。 */
  deleteWyPlaylist: (playlistId: string) => Promise<void>;
  fetchPlaylistDetail: (playlistId: string, source?: WyPlaylistInfo["source"], playlist?: WyPlaylistInfo) => Promise<void>;
  setWyPlaylistSubscribed: (
    userId: string,
    playlist: Pick<WyPlaylistInfo, "id">,
    subscribed: boolean,
  ) => Promise<void>;
  clearPlaylists: () => void;
  loadLocalPlaylists: () => Promise<void>;
  createLocalPlaylist: (input: CreateLocalPlaylistInput) => Promise<void>;
  createLocalPlaylistWithSong: (input: CreateLocalPlaylistWithSongInput) => Promise<void>;
  createLocalPlaylistWithSongs: (input: CreateLocalPlaylistWithSongsInput) => Promise<void>;
  replaceLocalPlaylists: (localPlaylists: LocalPlaylist[]) => Promise<void>;
  duplicateLocalPlaylist: (playlistId: string, options?: DuplicateLocalPlaylistOptions) => Promise<LocalPlaylist>;
  updateLocalPlaylistInfo: (playlistId: string, input: UpdateLocalPlaylistInfoInput) => Promise<void>;
  renameLocalPlaylist: (playlistId: string, name: string, now?: number) => Promise<void>;
  deleteLocalPlaylist: (playlistId: string) => Promise<void>;
  addSongToLocalPlaylist: (playlistId: string, song: MusicInfo, now?: number) => Promise<void>;
  addSongsToLocalPlaylist: (playlistId: string, songs: MusicInfo[]) => Promise<{ addedCount: number; skippedCount: number }>;
  addSongToWyPlaylist: (playlistId: string, song: MusicInfo) => Promise<void>;
  removeSongFromWyPlaylist: (playlistId: string, song: MusicInfo) => Promise<void>;
  removeSongFromLocalPlaylist: (playlistId: string, song: Pick<MusicInfo, "source" | "id">, now?: number) => Promise<void>;
  /** WebDAV 同步覆盖：替换云端歌单列表（收藏在 favoritesStore、本地歌单单独替换）。 */
  replaceAllFromSync: (playlists: WyPlaylistInfo[]) => void;
  /** WebDAV 同步合并：云端歌单/本地歌单与远端合并（不丢本地独有项）。 */
  mergeFromSync: (input: {
    cloudPlaylists: WyPlaylistInfo[];
    localPlaylists: LocalPlaylist[];
  }) => Promise<void>;
}

const LOCAL_PLAYLISTS_KEY = "auralflow.mobile.localPlaylists";

async function persistLocalPlaylists(localPlaylists: LocalPlaylist[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_PLAYLISTS_KEY, JSON.stringify(localPlaylists));
}

function parseLocalPlaylists(raw: string | null): LocalPlaylist[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("本地歌单数据格式错误");
  return parsed as LocalPlaylist[];
}

function songKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

/**
 * 读取并解析持久化数组；解析失败时备份坏串、重建空结构（损坏自愈）。
 * 直接抛错会让每次启动都失败，歌单/收藏在 UI 上"永久消失"且无法恢复。
 */
async function loadPersistedArray<T>(key: string, parse: (raw: string | null) => T[]): Promise<T[]> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(key);
    return parse(raw);
  } catch (error) {
    console.error(`[storage] ${key} 数据损坏，已备份并重建空列表`, error);
    await healCorruptStorage(key, raw);
    return [];
  }
}

type PlaylistStore = PlaylistState & PlaylistActions;

const playlistDetailRequestGate = new LatestRequestGate();

export const usePlaylistStore = create<PlaylistStore>((set, get) => ({
  playlists: [],
  currentPlaylist: null,
  currentPlaylistSongs: [],
  localPlaylists: [],
  loading: false,
  error: null,

  fetchPlaylists: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const playlists = await getUserPlaylists(userId);
      set({ playlists, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "获取歌单失败";
      set({ error: message, loading: false });
    }
  },

  createWyPlaylist: async (name, description) => {
    set({ loading: true, error: null });
    try {
      await createWyPlaylistApi(name, { description });
      const { user } = useAccountStore.getState();
      if (user) {
        const playlists = await getUserPlaylists(user.userId);
        set({ playlists, loading: false });
      } else {
        set({ loading: false });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建歌单失败";
      set({ error: message, loading: false });
      throw error;
    }
  },

  updateWyPlaylistInfo: async (playlistId, changes) => {
    set({ loading: true, error: null });
    try {
      await updateWyPlaylistInfoApi(playlistId, changes);
      // 成功后本地乐观更新缓存字段。
      set((state) => ({
        loading: false,
        error: null,
        playlists: state.playlists.map((pl) =>
          pl.id === playlistId && pl.source === "wy"
            ? {
                ...pl,
                name: changes.name !== undefined ? changes.name : pl.name,
                desc: changes.description !== undefined ? changes.description : pl.desc,
              }
            : pl,
        ),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "编辑歌单失败";
      set({ error: message, loading: false });
      throw error;
    }
  },

  deleteWyPlaylist: async (playlistId) => {
    set({ loading: true, error: null });
    try {
      await deleteWyPlaylistApi(playlistId);
      // 删除成功后从本地列表移除。
      set((state) => ({
        loading: false,
        error: null,
        playlists: state.playlists.filter((pl) => !(pl.id === playlistId && pl.source === "wy")),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除歌单失败";
      set({ error: message, loading: false });
      throw error;
    }
  },

  fetchPlaylistDetail: async (playlistId, source = "wy", inputPlaylist) => {
    const requestId = playlistDetailRequestGate.begin();
    set({ loading: true, error: null });
    try {
      const { playlists } = get();
      const playlist = inputPlaylist || playlists.find((p) => p.id === playlistId && p.source === source) || null;
      const songs = source === "tx" && playlist
        ? await getTxPlaylistDetail(playlist)
        : await getPlaylistDetail(playlistId);
      if (!playlistDetailRequestGate.isCurrent(requestId)) return;
      set({
        currentPlaylist: playlist,
        currentPlaylistSongs: songs,
        loading: false,
      });
    } catch (error) {
      if (!playlistDetailRequestGate.isCurrent(requestId)) return;
      const message = error instanceof Error ? error.message : "获取歌单详情失败";
      set({ error: message, loading: false });
    }
  },

  setWyPlaylistSubscribed: async (userId, playlist, subscribed) => {
    try {
      const existing = get().playlists.find((item) => item.id === playlist.id && item.source === "wy");
      if (!subscribed && existing?.subscribed === false) {
        throw new Error("自建歌单不能取消收藏");
      }

      await subscribePlaylist(playlist.id, subscribed);
      if (!subscribed) {
        set({
          playlists: get().playlists.filter((item) => !(item.source === "wy" && item.id === playlist.id)),
          currentPlaylist: get().currentPlaylist?.id === playlist.id ? null : get().currentPlaylist,
          currentPlaylistSongs: get().currentPlaylist?.id === playlist.id ? [] : get().currentPlaylistSongs,
          error: null,
        });
        return;
      }

      const playlists = await getUserPlaylists(userId);
      set({ playlists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "网易云歌单收藏失败";
      set({ error: message });
      throw error;
    }
  },

  clearPlaylists: () => {
    set({
      playlists: [],
      currentPlaylist: null,
      currentPlaylistSongs: [],
    });
  },


  loadLocalPlaylists: async () => {
    try {
      const localPlaylists = await loadPersistedArray(LOCAL_PLAYLISTS_KEY, parseLocalPlaylists);
      set({ localPlaylists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载本地歌单失败";
      set({ error: message });
      throw error;
    }
  },


  createLocalPlaylist: async (input) => {
    try {
      const localPlaylists = createLocalPlaylistModel(get().localPlaylists, input);
      await persistLocalPlaylists(localPlaylists);
      set({ localPlaylists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建本地歌单失败";
      set({ error: message });
      throw error;
    }
  },


  createLocalPlaylistWithSong: async (input) => {
    try {
      const localPlaylists = createLocalPlaylistWithSongModel(get().localPlaylists, input);
      await persistLocalPlaylists(localPlaylists);
      set({ localPlaylists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建本地歌单失败";
      set({ error: message });
      throw error;
    }
  },

  createLocalPlaylistWithSongs: async (input) => {
    try {
      const localPlaylists = createLocalPlaylistWithSongsModel(get().localPlaylists, input);
      await persistLocalPlaylists(localPlaylists);
      set({ localPlaylists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建本地歌单失败";
      set({ error: message });
      throw error;
    }
  },


  replaceLocalPlaylists: async (localPlaylists) => {
    try {
      await persistLocalPlaylists(localPlaylists);
      set({ localPlaylists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "替换本地歌单失败";
      set({ error: message });
      throw error;
    }
  },

  duplicateLocalPlaylist: async (playlistId, options) => {
    try {
      const localPlaylists = duplicateLocalPlaylistModel(get().localPlaylists, playlistId, options);
      const duplicated = localPlaylists[localPlaylists.length - 1];
      if (!duplicated) throw new Error("歌单不存在");
      await persistLocalPlaylists(localPlaylists);
      set({ localPlaylists, error: null });
      return duplicated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "复制本地歌单失败";
      set({ error: message });
      throw error;
    }
  },

  updateLocalPlaylistInfo: async (playlistId, input) => {
    try {
      const localPlaylists = updateLocalPlaylistInfoModel(get().localPlaylists, playlistId, input);
      await persistLocalPlaylists(localPlaylists);
      set({ localPlaylists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "编辑本地歌单失败";
      set({ error: message });
      throw error;
    }
  },

  renameLocalPlaylist: async (playlistId, name, now) => {
    try {
      const localPlaylists = renameLocalPlaylistModel(get().localPlaylists, playlistId, name, now);
      await persistLocalPlaylists(localPlaylists);
      set({ localPlaylists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "重命名本地歌单失败";
      set({ error: message });
      throw error;
    }
  },

  deleteLocalPlaylist: async (playlistId) => {
    try {
      const localPlaylists = deleteLocalPlaylistModel(get().localPlaylists, playlistId);
      await persistLocalPlaylists(localPlaylists);
      set({ localPlaylists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除本地歌单失败";
      set({ error: message });
      throw error;
    }
  },

  addSongToLocalPlaylist: async (playlistId, song, now) => {
    try {
      const localPlaylists = addSongToLocalPlaylistModel(get().localPlaylists, playlistId, song, now);
      await persistLocalPlaylists(localPlaylists);
      set({ localPlaylists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "添加到本地歌单失败";
      set({ error: message });
      throw error;
    }
  },

  addSongsToLocalPlaylist: async (playlistId, songs) => {
    try {
      const result = addSongsToLocalPlaylistModel(get().localPlaylists, playlistId, songs);
      await persistLocalPlaylists(result.playlists);
      set({ localPlaylists: result.playlists, error: null });
      return { addedCount: result.addedCount, skippedCount: result.skippedCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : "添加到本地歌单失败";
      set({ error: message });
      throw error;
    }
  },

  addSongToWyPlaylist: async (playlistId, song) => {
    try {
      if (song.source !== "wy") {
        throw new Error("当前只支持添加网易云歌曲到网易云歌单");
      }

      const target = get().playlists.find((playlist) => playlist.id === playlistId && playlist.source === "wy");
      if (!target) {
        throw new Error("网易云歌单不存在");
      }
      if (target.subscribed === true) {
        throw new Error("收藏歌单不支持添加歌曲");
      }

      await addPlaylistTracks(playlistId, [String(song.id)]);
      const key = songKey(song);
      const { currentPlaylist, currentPlaylistSongs } = get();
      const shouldUpdateCurrentSongs = currentPlaylist?.source === "wy" && currentPlaylist.id === playlistId;
      const hasSongInCurrent = currentPlaylistSongs.some((item) => songKey(item) === key);

      set({
        playlists: get().playlists.map((playlist) =>
          playlist.id === playlistId && playlist.source === "wy"
            ? { ...playlist, trackCount: (playlist.trackCount ?? 0) + 1 }
            : playlist,
        ),
        currentPlaylist: currentPlaylist && currentPlaylist.source === "wy" && currentPlaylist.id === playlistId
          ? { ...currentPlaylist, trackCount: (currentPlaylist.trackCount ?? 0) + 1 }
          : currentPlaylist,
        currentPlaylistSongs: shouldUpdateCurrentSongs && !hasSongInCurrent
          ? [song, ...currentPlaylistSongs]
          : currentPlaylistSongs,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "添加到网易云歌单失败";
      set({ error: message });
      throw error;
    }
  },

  removeSongFromWyPlaylist: async (playlistId, song) => {
    try {
      if (song.source !== "wy") {
        throw new Error("当前只支持从网易云歌单删除网易云歌曲");
      }

      const target = get().playlists.find((playlist) => playlist.id === playlistId && playlist.source === "wy");
      if (!target) {
        throw new Error("网易云歌单不存在");
      }
      if (target.subscribed === true) {
        throw new Error("收藏歌单不支持删除歌曲");
      }

      await removePlaylistTracks(playlistId, [String(song.id)]);
      const key = songKey(song);
      const { currentPlaylist, currentPlaylistSongs } = get();
      const shouldUpdateCurrentSongs = currentPlaylist?.source === "wy" && currentPlaylist.id === playlistId;

      set({
        playlists: get().playlists.map((playlist) =>
          playlist.id === playlistId && playlist.source === "wy"
            ? { ...playlist, trackCount: Math.max(0, (playlist.trackCount ?? 0) - 1) }
            : playlist,
        ),
        currentPlaylist: currentPlaylist && currentPlaylist.source === "wy" && currentPlaylist.id === playlistId
          ? { ...currentPlaylist, trackCount: Math.max(0, (currentPlaylist.trackCount ?? 0) - 1) }
          : currentPlaylist,
        currentPlaylistSongs: shouldUpdateCurrentSongs
          ? currentPlaylistSongs.filter((item) => songKey(item) !== key)
          : currentPlaylistSongs,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "从网易云歌单删除歌曲失败";
      set({ error: message });
      throw error;
    }
  },

  removeSongFromLocalPlaylist: async (playlistId, song, now) => {
    try {
      const localPlaylists = removeSongFromLocalPlaylistModel(get().localPlaylists, playlistId, song, now);
      await persistLocalPlaylists(localPlaylists);
      set({ localPlaylists, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "从本地歌单移除歌曲失败";
      set({ error: message });
      throw error;
    }
  },
  mergeFromSync: async ({ cloudPlaylists, localPlaylists }) => {
    const current = get();
    const mergedLocal = mergeWebdavLocalPlaylists(current.localPlaylists, localPlaylists);
    const mergedCloud = mergeWebdavCloudPlaylists(current.playlists, cloudPlaylists);
    await persistLocalPlaylists(mergedLocal);
    set({
      playlists: mergedCloud,
      localPlaylists: mergedLocal,
      error: null,
    });
  },
  replaceAllFromSync: (playlists) => {
    set({
      playlists,
      currentPlaylist: null,
      currentPlaylistSongs: [],
    });
  },
}));


