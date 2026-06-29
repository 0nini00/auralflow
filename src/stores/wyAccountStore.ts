import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import {
  setWyCookie,
  getWyCookie,
  checkAccount,
  getUserPlaylists,
  getPlaylistDetail,
  addPlaylistTracks,
  removePlaylistTracks,
  subscribePlaylist,
  getWyTrackId,
  type AccountInfo,
  type WyPlaylistInfo,
} from "@/services/wyAccountService";

interface WyAccountState {
  account: AccountInfo | null;
  playlists: WyPlaylistInfo[];
  isLoading: boolean;
  isLoaded: boolean;
  error: string;

  load: (cookieStr?: string) => Promise<void>;
  getPlaylistSongs: (id: string) => Promise<MusicInfo[]>;
  /** 强制刷新某个网易云歌单：清缓存并重新拉取详情 */
  refreshPlaylistSongs: (id: string) => Promise<MusicInfo[]>;

  /** 把 wy 歌曲加入自建歌单（非 wy 歌曲会被忽略并报错） */
  addTracks: (playlistId: string, songs: MusicInfo[]) => Promise<void>;
  /** 从自建歌单移除歌曲 */
  removeTracks: (playlistId: string, songs: MusicInfo[]) => Promise<void>;
  /** 收藏 / 取消收藏一个歌单。subscribe=false 时若是自建歌单会拒绝 */
  setSubscribed: (playlistId: string, subscribe: boolean) => Promise<void>;
}

const playlistCache = new Map<string, MusicInfo[]>();

function extractWyTrackIds(songs: MusicInfo[]): string[] {
  const ids: string[] = [];
  for (const song of songs) {
    const id = getWyTrackId(song);
    if (id) ids.push(id);
  }
  return ids;
}

export const useWyAccountStore = create<WyAccountState>((set, get) => ({
  account: null,
  playlists: [],
  isLoading: false,
  isLoaded: false,
  error: "",

  load: async (cookieStr) => {
    try {
      const cookie = cookieStr ?? (await getWyCookie());
      if (!cookie) {
        playlistCache.clear();
        set({ isLoaded: true, playlists: [], account: null });
        return;
      }

      setWyCookie(cookie);
      set({ isLoading: true, error: "" });

      const account = await checkAccount();
      const playlists = await getUserPlaylists(account.uid);
      playlistCache.clear();
      set({ playlists, isLoaded: true, isLoading: false });
      set({ account });
    } catch (e) {
      playlistCache.clear();
      set({
        account: null,
        playlists: [],
        error: e instanceof Error ? e.message : String(e),
        isLoading: false,
        isLoaded: true,
      });
    }
  },

  getPlaylistSongs: async (id: string) => {
    const cached = playlistCache.get(id);
    if (cached) return cached;

    const songs = await getPlaylistDetail(id);
    playlistCache.set(id, songs);
    return songs;
  },

  refreshPlaylistSongs: async (id: string) => {
    playlistCache.delete(id);
    const songs = await getPlaylistDetail(id);
    playlistCache.set(id, songs);
    return songs;
  },

  addTracks: async (playlistId, songs) => {
    const target = get().playlists.find((p) => p.id === playlistId);
    if (target?.subscribed) throw new Error("收藏歌单不支持添加歌曲");

    const trackIds = extractWyTrackIds(songs);
    if (trackIds.length === 0) throw new Error("当前只支持添加网易云歌曲到网易云歌单");

    await addPlaylistTracks(playlistId, trackIds);

    // 本地缓存：把新歌前置去重
    const cached = playlistCache.get(playlistId);
    if (cached) {
      const seen = new Set(cached.map((s) => `${s.source}:${s.id}`));
      const additions = songs.filter((s) => {
        const id = getWyTrackId(s);
        return id && !seen.has(`wy:${id}`);
      });
      playlistCache.set(playlistId, [...additions, ...cached]);
    }

    if (target) {
      set({
        playlists: get().playlists.map((p) =>
          p.id === playlistId
            ? { ...p, trackCount: (p.trackCount ?? 0) + trackIds.length }
            : p,
        ),
      });
    }
  },

  removeTracks: async (playlistId, songs) => {
    const target = get().playlists.find((p) => p.id === playlistId);
    if (target?.subscribed) throw new Error("收藏歌单不支持删除歌曲");

    const trackIds = extractWyTrackIds(songs);
    if (trackIds.length === 0) throw new Error("缺少网易云歌曲 ID");

    await removePlaylistTracks(playlistId, trackIds);

    const removed = new Set(trackIds);
    const cached = playlistCache.get(playlistId);
    if (cached) {
      playlistCache.set(
        playlistId,
        cached.filter((s) => !(s.source === "wy" && removed.has(String(s.id)))),
      );
    }

    if (target) {
      set({
        playlists: get().playlists.map((p) =>
          p.id === playlistId
            ? { ...p, trackCount: Math.max(0, (p.trackCount ?? 0) - trackIds.length) }
            : p,
        ),
      });
    }
  },

  setSubscribed: async (playlistId, subscribe) => {
    if (!subscribe) {
      const target = get().playlists.find((p) => p.id === playlistId);
      if (target && target.subscribed === false) {
        throw new Error("自建歌单不能取消收藏");
      }
    }

    await subscribePlaylist(playlistId, subscribe);

    if (!subscribe) {
      // 取消收藏：从列表移除并清缓存
      playlistCache.delete(playlistId);
      set({ playlists: get().playlists.filter((p) => p.id !== playlistId) });
    } else {
      // 收藏：刷新一次列表，让新收藏出现
      const account = get().account;
      if (account) {
        try {
          const playlists = await getUserPlaylists(account.uid);
          set({ playlists });
        } catch {
          // 刷新失败不抛出，操作本身已成功
        }
      }
    }
  },
}));
