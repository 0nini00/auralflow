import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WyPlaylistInfo } from "../services/wyPlaylistService";
import { getTxPlaylistDetail } from "../services/txPlaylistService";
import type { MusicInfo } from "@lx/core";
import type { CreateLocalPlaylistInput, CreateLocalPlaylistWithSongInput, CreateLocalPlaylistWithSongsInput, LocalPlaylist } from "../services/localPlaylistModel";
import {
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
  getLikedSongs,
  likeSong as likeSongApi,
  removePlaylistTracks,
  subscribePlaylist,
  unlikeSong as unlikeSongApi,
} from "../services/wyPlaylistService";

export interface PlaylistState {
  playlists: WyPlaylistInfo[];
  currentPlaylist: WyPlaylistInfo | null;
  currentPlaylistSongs: MusicInfo[];
  likedPlaylist: WyPlaylistInfo | null;
  likedSongs: MusicInfo[];
  likedSongIds: Set<string>;
  localPlaylists: LocalPlaylist[];
  loading: boolean;
  error: string | null;
}

interface PlaylistActions {
  fetchPlaylists: (userId: string) => Promise<void>;
  fetchPlaylistDetail: (playlistId: string, source?: WyPlaylistInfo["source"], playlist?: WyPlaylistInfo) => Promise<void>;
  fetchLikedSongs: (userId: string) => Promise<void>;
  likeSong: (song: MusicInfo) => Promise<void>;
  unlikeSong: (song: MusicInfo) => Promise<void>;
  setWyPlaylistSubscribed: (
    userId: string,
    playlist: Pick<WyPlaylistInfo, "id">,
    subscribed: boolean,
  ) => Promise<void>;
  isLiked: (song: MusicInfo | null | undefined) => boolean;
  clearPlaylists: () => void;
  loadLocalPlaylists: () => Promise<void>;
  loadLikedSongsFromStorage: () => Promise<void>;
  createLocalPlaylist: (input: CreateLocalPlaylistInput) => Promise<void>;
  createLocalPlaylistWithSong: (input: CreateLocalPlaylistWithSongInput) => Promise<void>;
  createLocalPlaylistWithSongs: (input: CreateLocalPlaylistWithSongsInput) => Promise<void>;
  replaceLocalPlaylists: (localPlaylists: LocalPlaylist[]) => Promise<void>;
  duplicateLocalPlaylist: (playlistId: string, options?: DuplicateLocalPlaylistOptions) => Promise<LocalPlaylist>;
  updateLocalPlaylistInfo: (playlistId: string, input: UpdateLocalPlaylistInfoInput) => Promise<void>;
  renameLocalPlaylist: (playlistId: string, name: string, now?: number) => Promise<void>;
  deleteLocalPlaylist: (playlistId: string) => Promise<void>;
  addSongToLocalPlaylist: (playlistId: string, song: MusicInfo, now?: number) => Promise<void>;
  addSongToWyPlaylist: (playlistId: string, song: MusicInfo) => Promise<void>;
  removeSongFromWyPlaylist: (playlistId: string, song: MusicInfo) => Promise<void>;
  removeSongFromLocalPlaylist: (playlistId: string, song: Pick<MusicInfo, "source" | "id">, now?: number) => Promise<void>;
  /** WebDAV 同步覆盖：同时替换收藏歌曲和歌单列表。 */
  replaceAllFromSync: (likedSongs: MusicInfo[], playlists: WyPlaylistInfo[]) => void;
}

const LIKED_PLAYLIST_NAME = "我喜欢的音乐";
const LOCAL_PLAYLISTS_KEY = "auralflow.mobile.localPlaylists";
const LIKED_SONGS_KEY = "auralflow.mobile.likedSongs";

function getLikedPlaylist(playlists: WyPlaylistInfo[]) {
  return playlists.find((playlist) => playlist.name === LIKED_PLAYLIST_NAME) || null;
}

function songKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

async function persistLocalPlaylists(localPlaylists: LocalPlaylist[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_PLAYLISTS_KEY, JSON.stringify(localPlaylists));
}

async function persistLikedSongs(likedSongs: MusicInfo[]): Promise<void> {
  await AsyncStorage.setItem(LIKED_SONGS_KEY, JSON.stringify(likedSongs));
}

function parseLocalPlaylists(raw: string | null): LocalPlaylist[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("本地歌单数据格式错误");
  return parsed as LocalPlaylist[];
}

function parseLikedSongs(raw: string | null): MusicInfo[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("喜欢歌曲数据格式错误");
  return parsed as MusicInfo[];
}

type PlaylistStore = PlaylistState & PlaylistActions;

export const usePlaylistStore = create<PlaylistStore>((set, get) => ({
  playlists: [],
  currentPlaylist: null,
  currentPlaylistSongs: [],
  likedPlaylist: null,
  likedSongs: [],
  likedSongIds: new Set(),
  localPlaylists: [],
  loading: false,
  error: null,

  fetchPlaylists: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const playlists = await getUserPlaylists(userId);
      set({
        playlists,
        likedPlaylist: getLikedPlaylist(playlists),
        loading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "获取歌单失败";
      set({ error: message, loading: false });
    }
  },

  fetchPlaylistDetail: async (playlistId, source = "wy", inputPlaylist) => {
    set({ loading: true, error: null });
    try {
      const { playlists, likedPlaylist } = get();
      const playlist = inputPlaylist || playlists.find((p) => p.id === playlistId && p.source === source) || null;
      const songs = source === "tx" && playlist
        ? await getTxPlaylistDetail(playlist)
        : await getPlaylistDetail(playlistId);
      const isLikedPlaylist = source === "wy" && likedPlaylist?.id === playlistId;
      set({
        currentPlaylist: playlist,
        currentPlaylistSongs: songs,
        likedSongs: isLikedPlaylist ? songs : get().likedSongs,
        likedSongIds: isLikedPlaylist
          ? new Set(songs.map(songKey))
          : get().likedSongIds,
        loading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "获取歌单详情失败";
      set({ error: message, loading: false });
    }
  },

  fetchLikedSongs: async (userId: string) => {
    try {
      const likedIds = await getLikedSongs(userId);
      const { playlists, likedPlaylist } = get();
      const resolvedLikedPlaylist = likedPlaylist || getLikedPlaylist(playlists);
      const likedSongs = resolvedLikedPlaylist ? await getPlaylistDetail(resolvedLikedPlaylist.id) : [];
      set({
        likedSongIds: likedSongs.length > 0 ? new Set(likedSongs.map(songKey)) : new Set(likedIds.map((id) => `wy:${id}`)),
        likedSongs,
        likedPlaylist: resolvedLikedPlaylist
          ? {
              ...resolvedLikedPlaylist,
              trackCount: likedSongs.length || resolvedLikedPlaylist.trackCount,
            }
          : null,
      });
    } catch (error) {
      console.error("Fetch liked songs error:", error);
    }
  },

  likeSong: async (song) => {
    try {
      const { likedSongIds, likedSongs, currentPlaylistSongs, likedPlaylist, currentPlaylist } = get();
      const key = songKey(song);
      if (song.source === "wy") await likeSongApi(song.id);
      const nextLikedSongIds = new Set(likedSongIds);
      nextLikedSongIds.add(key);
      const songToAdd = [...currentPlaylistSongs, ...likedSongs, song].find((item) => songKey(item) === key);
      const nextLikedSongs = songToAdd && !likedSongs.some((item) => songKey(item) === key)
        ? [songToAdd, ...likedSongs]
        : likedSongs;
      await persistLikedSongs(nextLikedSongs);
      set({
        likedSongIds: nextLikedSongIds,
        likedSongs: nextLikedSongs,
        currentPlaylistSongs:
          currentPlaylist && likedPlaylist && currentPlaylist.id === likedPlaylist.id
            ? nextLikedSongs
            : currentPlaylistSongs,
        likedPlaylist: likedPlaylist
          ? {
              ...likedPlaylist,
              trackCount: nextLikedSongs.length || likedPlaylist.trackCount + 1,
            }
          : likedPlaylist,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "喜欢失败";
      set({ error: message });
      throw error;
    }
  },

  unlikeSong: async (song) => {
    try {
      const { likedSongIds, likedSongs, currentPlaylistSongs, likedPlaylist, currentPlaylist } = get();
      const key = songKey(song);
      if (song.source === "wy") await unlikeSongApi(song.id);
      const nextLikedSongIds = new Set(likedSongIds);
      nextLikedSongIds.delete(key);
      const nextLikedSongs = likedSongs.filter((item) => songKey(item) !== key);
      await persistLikedSongs(nextLikedSongs);
      set({
        likedSongIds: nextLikedSongIds,
        likedSongs: nextLikedSongs,
        currentPlaylistSongs:
          currentPlaylist && likedPlaylist && currentPlaylist.id === likedPlaylist.id
            ? nextLikedSongs
            : currentPlaylistSongs,
        likedPlaylist: likedPlaylist
          ? { ...likedPlaylist, trackCount: nextLikedSongs.length }
          : likedPlaylist,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "取消喜欢失败";
      set({ error: message });
      throw error;
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
      set({
        playlists,
        likedPlaylist: getLikedPlaylist(playlists),
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "网易云歌单收藏失败";
      set({ error: message });
      throw error;
    }
  },

  isLiked: (song) => {
    return song ? get().likedSongIds.has(songKey(song)) : false;
  },

  clearPlaylists: () => {
    set({
      playlists: [],
      currentPlaylist: null,
      currentPlaylistSongs: [],
      likedPlaylist: null,
      likedSongs: [],
      likedSongIds: new Set(),
    });
  },


  loadLocalPlaylists: async () => {
    try {
      const raw = await AsyncStorage.getItem(LOCAL_PLAYLISTS_KEY);
      set({ localPlaylists: parseLocalPlaylists(raw), error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载本地歌单失败";
      set({ error: message });
      throw error;
    }
  },


  loadLikedSongsFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(LIKED_SONGS_KEY);
      const likedSongs = parseLikedSongs(raw);
      set({
        likedSongs,
        likedSongIds: new Set(likedSongs.map(songKey)),
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载喜欢歌曲失败";
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
  replaceAllFromSync: (likedSongs, playlists) => {
    const likedPlaylist = getLikedPlaylist(playlists);
    void persistLikedSongs(likedSongs);
    set({
      playlists,
      likedPlaylist,
      likedSongs,
      likedSongIds: new Set(likedSongs.map(songKey)),
      currentPlaylist: null,
      currentPlaylistSongs: [],
    });
  },
}));


