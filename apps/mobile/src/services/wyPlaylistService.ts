import { getWyCookie } from "./wyAccountService";
import type { PlaylistInfo, MusicInfo } from "@lx/core";
import CryptoJS from "crypto-js";
import forge from "node-forge";
import {
  buildNeteasePcCookie,
  buildWyPlaylistSubscribeRequest,
} from "./wyPlaylistSubscribeModel";

/**
 * 网易云歌单信息（扩展）
 */
export interface WyPlaylistInfo extends PlaylistInfo {
  coverImgUrl?: string;
  trackCount: number;
  playCount?: number;
  subscribed?: boolean;
  creator?: {
    userId: string;
    nickname: string;
  };
}

export interface DailyRecommendResult {
  songs: MusicInfo[];
  hasMore: boolean;
}

export interface PersonalFmResult {
  songs: MusicInfo[];
  hasMore: boolean;
}

const WY_REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};
const WY_IV = CryptoJS.enc.Utf8.parse("0102030405060708");
const WY_PRESET_KEY = CryptoJS.enc.Utf8.parse("0CoJUm6Qyw8W8jud");
const WY_PUBLIC_KEY =
  "-----BEGIN PUBLIC KEY-----\n" +
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n" +
  "-----END PUBLIC KEY-----";
const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

type JsonRecord = Record<string, any>;

function randSecretKey(length = 16): string {
  let key = "";
  for (let i = 0; i < length; i += 1) {
    key += BASE62[Math.floor(Math.random() * BASE62.length)];
  }
  return key;
}

function rsaNoPaddingEncrypt(input: string): string {
  const publicKey = forge.pki.publicKeyFromPem(WY_PUBLIC_KEY);
  const padded = "\0".repeat(128 - input.length) + input;
  const msgHex = forge.util.bytesToHex(padded);
  const message = new forge.jsbn.BigInteger(msgHex, 16);
  const encrypted = message.modPow(publicKey.e, publicKey.n);
  return encrypted.toString(16).padStart(256, "0");
}

function buildWeapiBody(data: Record<string, any>): string {
  const text = JSON.stringify(data);
  const secretKeyText = randSecretKey(16);
  const secretKey = CryptoJS.enc.Utf8.parse(secretKeyText);
  const encryptedOnce = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(text), WY_PRESET_KEY, {
    iv: WY_IV,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString();
  const params = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(encryptedOnce), secretKey, {
    iv: WY_IV,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString();
  const encSecKey = rsaNoPaddingEncrypt(secretKeyText.split("").reverse().join(""));
  return new URLSearchParams({ params, encSecKey }).toString();
}

function csrfToken(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)__?csrf=([^;]+)/);
  return match?.[1] ?? "";
}

async function postWyWeapi(
  path: string,
  payload: Record<string, any>,
  cookie: string,
): Promise<JsonRecord> {
  const response = await fetch(`https://music.163.com/weapi${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://music.163.com",
      Referer: "https://music.163.com",
      Cookie: buildNeteasePcCookie(cookie),
      ...WY_REQUEST_HEADERS,
    },
    body: buildWeapiBody({
      ...payload,
      csrf_token: csrfToken(cookie),
    }),
  });

  const data = (await response.json()) as JsonRecord;
  if (!response.ok) {
    throw new Error(data?.message || `请求失败 HTTP ${response.status}`);
  }
  return data;
}

function mapWyTrackToMusicInfo(track: any): MusicInfo {
  const artwork = track.al?.picUrl || track.album?.picUrl || track.picUrl;

  return {
    id: String(track.id),
    name: track.name,
    singer: track.ar?.map((artist: any) => artist.name).join(", ") || "未知艺术家",
    albumName: track.al?.name || track.album?.name || "未知专辑",
    source: "wy" as const,
    interval: Math.floor((track.dt || track.duration || 0) / 1000),
    picUrl: artwork,
    img: artwork,
    gateway: {
      source: "netease",
      trackId: String(track.id),
      lyricId: String(track.id),
      picId: String(track.id),
    },
  };
}

/**
 * 获取用户歌单
 */
export async function getUserPlaylists(userId: string): Promise<WyPlaylistInfo[]> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetch(
      `https://music.163.com/api/user/playlist?uid=${userId}&limit=1000&offset=0`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code === 200 && data.playlist) {
      return data.playlist.map((item: any) => ({
        id: String(item.id),
        name: item.name,
        author: item.creator?.nickname || "未知",
        picUrl: item.coverImgUrl,
        coverImgUrl: item.coverImgUrl,
        desc: item.description,
        playCount: item.playCount,
        trackCount: item.trackCount || 0,
        source: "wy" as const,
        subscribed: item.subscribed,
        creator: {
          userId: String(item.creator?.userId),
          nickname: item.creator?.nickname,
        },
      }));
    }

    throw new Error("获取歌单失败");
  } catch (error) {
    console.error("Get user playlists error:", error);
    throw error;
  }
}

/**
 * 获取歌单详情（歌曲列表）
 */
export async function getPlaylistDetail(playlistId: string): Promise<MusicInfo[]> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetch(
      `https://music.163.com/api/v6/playlist/detail?id=${playlistId}&n=100000`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code === 200 && data.playlist?.tracks) {
      return data.playlist.tracks.map(mapWyTrackToMusicInfo);
    }

    throw new Error("获取歌单详情失败");
  } catch (error) {
    console.error("Get playlist detail error:", error);
    throw error;
  }
}

/**
 * 喜欢歌曲
 */
export async function likeSong(songId: string): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetch(
      `https://music.163.com/api/radio/like?alg=itembased&trackId=${songId}&like=true&time=3`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code !== 200) {
      throw new Error("喜欢歌曲失败");
    }
  } catch (error) {
    console.error("Like song error:", error);
    throw error;
  }
}

/**
 * 取消喜欢歌曲
 */
export async function unlikeSong(songId: string): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetch(
      `https://music.163.com/api/radio/like?alg=itembased&trackId=${songId}&like=false&time=3`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code !== 200) {
      throw new Error("取消喜欢失败");
    }
  } catch (error) {
    console.error("Unlike song error:", error);
    throw error;
  }
}

export async function subscribePlaylist(playlistId: string, subscribe: boolean): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  const request = buildWyPlaylistSubscribeRequest(playlistId, subscribe);
  const data = await postWyWeapi(request.path, request.payload, cookie);
  if (data.code !== 200) {
    throw new Error(data.message || "网易云歌单收藏失败");
  }
}

async function manipulatePlaylistTracks(
  op: "add" | "del",
  playlistId: string,
  trackIds: string[],
): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  const ids = trackIds.map((id) => String(id)).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("缺少网易云歌曲 ID");
  }

  const buildPayload = (targetIds: string[]) => ({
    op,
    pid: String(playlistId),
    trackIds: JSON.stringify(targetIds),
    imme: "true",
  });

  let data = await postWyWeapi("/playlist/manipulate/tracks", buildPayload(ids), cookie);
  if (op === "add" && data.code === 512) {
    data = await postWyWeapi("/playlist/manipulate/tracks", buildPayload([...ids, ...ids]), cookie);
  }
  if (data.code !== 200 && data.code !== 201) {
    throw new Error(data.message || "网易云歌单歌曲操作失败");
  }
}

export async function addPlaylistTracks(playlistId: string, trackIds: string[]): Promise<void> {
  await manipulatePlaylistTracks("add", playlistId, trackIds);
}

export async function removePlaylistTracks(playlistId: string, trackIds: string[]): Promise<void> {
  await manipulatePlaylistTracks("del", playlistId, trackIds);
}

/**
 * 获取喜欢的音乐列表
 */
export async function getLikedSongs(userId: string): Promise<string[]> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetch(
      `https://music.163.com/api/song/like/get?uid=${userId}`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code === 200 && data.ids) {
      return data.ids.map((id: number) => String(id));
    }

    return [];
  } catch (error) {
    console.error("Get liked songs error:", error);
    return [];
  }
}

/**
 * 获取每日推荐歌曲
 */
export async function getDailyRecommendSongs(): Promise<DailyRecommendResult> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetch(
      "https://music.163.com/api/v3/discovery/recommend/songs",
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code !== 200) {
      throw new Error(data.message || "获取每日推荐失败");
    }

    const recommend = Array.isArray(data.data?.dailySongs) ? data.data.dailySongs : [];

    return {
      songs: recommend.map(mapWyTrackToMusicInfo),
      hasMore: Boolean(data.data?.hasMore),
    };
  } catch (error) {
    console.error("Get daily recommend songs error:", error);
    throw error;
  }
}

/**
 * 获取私人 FM
 */
export async function getPersonalFmSongs(): Promise<PersonalFmResult> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetch(
      "https://music.163.com/api/radio/get",
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code !== 200) {
      throw new Error(data.message || "获取私人 FM 失败");
    }

    const recommend = Array.isArray(data.data) ? data.data : [];

    return {
      songs: recommend.map(mapWyTrackToMusicInfo),
      hasMore: recommend.length > 0,
    };
  } catch (error) {
    console.error("Get personal fm songs error:", error);
    throw error;
  }
}

/**
 * 不喜欢当前 FM 歌曲
 */
export async function trashPersonalFmSong(songId: string): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetch(
      `https://music.163.com/api/radio/trash/add?alg=RT&songId=${songId}&time=0`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code !== 200) {
      throw new Error(data.message || "标记不喜欢失败");
    }
  } catch (error) {
    console.error("Trash personal fm song error:", error);
    throw error;
  }
}
