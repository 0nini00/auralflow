import { create } from "zustand";
import { patchSettings } from "@lx/tauri-bridge";
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
  logout: () => Promise<void>;
  getPlaylistSongs: (id: string) => Promise<MusicInfo[]>;
  preloadPlaylistSongs: (id: string) => void;
  /** 刷新网易云歌单列表 */
  refreshPlaylists: () => Promise<void>;
  /** 强制刷新某个网易云歌单：清缓存并重新拉取详情 */
  refreshPlaylistSongs: (id: string) => Promise<MusicInfo[]>;

  /** 把 wy 歌曲加入自建歌单（非 wy 歌曲会被忽略并报错） */
  addTracks: (playlistId: string, songs: MusicInfo[]) => Promise<void>;
  /** 从自建歌单移除歌曲 */
  removeTracks: (playlistId: string, songs: MusicInfo[]) => Promise<void>;
  /** 收藏 / 取消收藏一个歌单。subscribe=false 时若是自建歌单会拒绝 */
  setSubscribed: (playlistId: string, subscribe: boolean) => Promise<void>;
}

function createAccountGeneration() {
  return {
    playlistCache: new Map<string, MusicInfo[]>(),
    playlistRequestCache: new Map<string, Promise<MusicInfo[]>>(),
  };
}

// 世代由对象身份标识；相同 uid 退出后重新登录也不能复用上一会话。
let accountGeneration = createAccountGeneration();

function beginAccountGeneration() {
  accountGeneration = createAccountGeneration();
  return accountGeneration;
}

function clearPlaylistCaches(generation: ReturnType<typeof createAccountGeneration>) {
  generation.playlistCache.clear();
  generation.playlistRequestCache.clear();
}

function fetchAndCachePlaylistSongs(id: string, force = false): Promise<MusicInfo[]> {
  const generation = accountGeneration;
  const { playlistCache, playlistRequestCache } = generation;
  if (!force) {
    const cached = playlistCache.get(id);
    if (cached) return Promise.resolve(cached);

    const pending = playlistRequestCache.get(id);
    if (pending) return pending;
  } else {
    playlistCache.delete(id);
    playlistRequestCache.delete(id);
  }

  let request: Promise<MusicInfo[]>;
  request = getPlaylistDetail(id)
    .then((songs) => {
      if (generation === accountGeneration && playlistRequestCache.get(id) === request) {
        playlistCache.set(id, songs);
      }
      return songs;
    })
    .finally(() => {
      if (playlistRequestCache.get(id) === request) {
        playlistRequestCache.delete(id);
      }
    });

  playlistRequestCache.set(id, request);
  return request;
}

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
    // 在任何 await 之前隔离旧请求，同时撤下与待验证 Cookie 不再匹配的身份和列表。
    const generation = beginAccountGeneration();
    set({ account: null, playlists: [], isLoading: true, error: "" });
    try {
      const cookie = cookieStr ?? (await getWyCookie());
      if (generation !== accountGeneration) return;
      if (!cookie) {
        set({ isLoaded: true, isLoading: false, playlists: [], account: null, error: "" });
        return;
      }

      setWyCookie(cookie);

      // 先校验账号：成功就先落 account，避免歌单接口挂了把整登录态清掉
      const account = await checkAccount();
      if (generation !== accountGeneration) return;
      set({ account });

      try {
        const playlists = await getUserPlaylists(account.uid);
        if (generation !== accountGeneration) return;
        set({ playlists, isLoaded: true, isLoading: false, error: "" });
      } catch (playlistError) {
        if (generation !== accountGeneration) return;
        set({
          playlists: [],
          isLoaded: true,
          isLoading: false,
          // 账号仍有效，仅提示歌单拉取失败
          error: playlistError instanceof Error ? playlistError.message : String(playlistError),
        });
      }
    } catch (e) {
      if (generation !== accountGeneration) return;
      const msg = e instanceof Error ? e.message : String(e);
      const authBroken =
        /过期|无效|不一致|未设置网易云|缺少 MUSIC_U|请重新登录|请重新填写 Cookie/.test(msg);

      clearPlaylistCaches(generation);
      if (authBroken) {
        // 失效 Cookie 不要继续留在内存/设置里，否则下次启动会反复失败
        setWyCookie("");
        void patchSettings({ wyCookie: null }).catch(() => {
          // settings 写失败不阻断登出语义
        });
      }
      set({
        account: null,
        playlists: [],
        error: msg,
        isLoading: false,
        isLoaded: true,
      });
    }
  },

  refreshPlaylists: async () => {
    const generation = accountGeneration;
    const account = get().account;
    if (!account || get().isLoading) return;

    set({ isLoading: true, error: "" });
    try {
      const playlists = await getUserPlaylists(account.uid);
      if (generation !== accountGeneration) return;
      clearPlaylistCaches(generation);
      set({ playlists, isLoaded: true, isLoading: false, error: "" });
    } catch (error) {
      if (generation !== accountGeneration) return;
      set({
        isLoading: false,
        isLoaded: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  logout: async () => {
    const previous = get();
    const previousCookie = getWyCookie();
    const generation = beginAccountGeneration();
    setWyCookie("");
    set({
      account: null,
      playlists: [],
      isLoading: false,
      isLoaded: true,
      error: "",
    });
    try {
      await patchSettings({ wyCookie: null });
    } catch (error) {
      const cookie = await previousCookie;
      if (generation === accountGeneration) {
        // 只回滚身份；注销前及注销期间的请求、缓存都不能随之复活。
        beginAccountGeneration();
        setWyCookie(cookie);
        set({
          account: previous.account,
          playlists: previous.playlists,
          isLoading: false,
          isLoaded: previous.isLoaded,
          error: previous.error,
        });
      }
      throw error;
    }
  },

  getPlaylistSongs: async (id: string) => {
    return fetchAndCachePlaylistSongs(id);
  },

  preloadPlaylistSongs: (id: string) => {
    void fetchAndCachePlaylistSongs(id).catch(() => {
      // 预热失败不改 UI；正式进入详情页时仍会走可见错误路径。
    });
  },

  refreshPlaylistSongs: async (id: string) => {
    return fetchAndCachePlaylistSongs(id, true);
  },

  addTracks: async (playlistId, songs) => {
    const generation = accountGeneration;
    const { playlistCache } = generation;
    const target = get().playlists.find((p) => p.id === playlistId);
    if (target?.subscribed) throw new Error("收藏歌单不支持添加歌曲");

    const trackIds = extractWyTrackIds(songs);
    if (trackIds.length === 0) throw new Error("当前只支持添加网易云歌曲到网易云歌单");

    await addPlaylistTracks(playlistId, trackIds);
    if (generation !== accountGeneration) return;

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
    const generation = accountGeneration;
    const { playlistCache } = generation;
    const target = get().playlists.find((p) => p.id === playlistId);
    if (target?.subscribed) throw new Error("收藏歌单不支持删除歌曲");

    const trackIds = extractWyTrackIds(songs);
    if (trackIds.length === 0) throw new Error("缺少网易云歌曲 ID");

    await removePlaylistTracks(playlistId, trackIds);
    if (generation !== accountGeneration) return;

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
    const generation = accountGeneration;
    const { playlistCache, playlistRequestCache } = generation;
    if (!subscribe) {
      const target = get().playlists.find((p) => p.id === playlistId);
      if (target && target.subscribed === false) {
        throw new Error("自建歌单不能取消收藏");
      }
    }

    await subscribePlaylist(playlistId, subscribe);
    if (generation !== accountGeneration) return;

    if (!subscribe) {
      // 取消收藏：从列表移除并清缓存
      playlistCache.delete(playlistId);
      playlistRequestCache.delete(playlistId);
      set({ playlists: get().playlists.filter((p) => p.id !== playlistId) });
    } else {
      // 收藏：刷新一次列表，让新收藏出现
      const account = get().account;
      if (account) {
        try {
          const playlists = await getUserPlaylists(account.uid);
          if (generation !== accountGeneration) return;
          set({ playlists });
        } catch {
          // 刷新失败不抛出，操作本身已成功
        }
      }
    }
  },
}));
