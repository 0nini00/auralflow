/**
 * 网易云音乐 Provider — 前端直接用 tauri-plugin-http fetch 发请求
 *
 * 与 wyAccountService 模式完全一致：前端 weapi/eapi 加密 + fetch 直发，
 * 不经过 Rust reqwest（reqwest 对网易云 API 返回空响应，问题未解决前不用 Rust 端）。
 */
import type {
  MusicInfo,
  MusicSource,
  PlaylistInfo,
  SearchResult,
  SearchType,
} from "@lx/core";
import { fetch } from "@tauri-apps/plugin-http";
import { weapi } from "@/lib/crypto/weapi";
import { getWyCookie } from "@/services/wyAccountService";
import CryptoJS from "crypto-js";

// ─── 常量 ─────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.54";
const EAPI_KEY = "e82ckenh8dichen8";
const NETEASE_EAPI_BATCH = "http://interface.music.163.com/eapi/batch";

// ─── eapi 加密（与 Rust gateway.rs 的 eapi_encrypt 一致）───

function eapiEncrypt(url: string, object: Record<string, unknown>): string {
  const text = JSON.stringify(object);
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = CryptoJS.MD5(message).toString();
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(data), CryptoJS.enc.Utf8.parse(EAPI_KEY), {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  }).ciphertext.toString(CryptoJS.enc.Hex).toUpperCase();
}

// ─── HTTP 封装 ─────────────────────────────────────────

async function eapiRequest(url: string, data: Record<string, unknown>): Promise<any> {
  const cookie = await getWyCookie();
  const params = eapiEncrypt(url, data);
  const body = `params=${encodeURIComponent(params)}`;

  const headers: Record<string, string> = {
    "User-Agent": UA,
    Origin: "https://music.163.com",
    Referer: "https://music.163.com",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (cookie) headers["Cookie"] = cookie;

  const resp = await fetch(NETEASE_EAPI_BATCH, { method: "POST", headers, body });
  if (!resp.ok) throw new Error(`eapi HTTP ${resp.status}`);
  return resp.json();
}

async function weapiRequest(path: string, data: Record<string, unknown>): Promise<any> {
  const cookie = await getWyCookie();
  if (!cookie) throw new Error("未登录网易云");

  const csrfMatch = cookie.match(/__?csrf=([^;]+)/);
  const csrf = csrfMatch?.[1] ?? "";
  const { params, encSecKey } = weapi({ ...data, csrf_token: csrf });

  const url = `https://music.163.com/weapi${path}`;
  const body = new URLSearchParams({ params, encSecKey }).toString();

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Origin: "https://music.163.com",
      Referer: "https://music.163.com",
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await resp.text();
  if (!text?.trim()) throw new Error("服务器返回空响应");
  const json = JSON.parse(text);
  if (json.code !== 200) throw new Error(json.message ?? `code=${json.code}`);
  return json;
}

// ─── 数据映射（与原版 desktop 的 mapWySong 一致）───────

function mapWySong(item: any): MusicInfo {
  const album = item.al ?? item.album ?? {};
  const privilege = item.privilege ?? {};
  const maxBr = privilege.maxbr ?? item.maxbr ?? 128000;
  let quality = "128k";
  if (
    privilege.maxBrLevel === "hires" ||
    privilege.maxBrLevel === "lossless" ||
    maxBr >= 999000
  ) {
    quality = "flac";
  } else if (maxBr >= 320000) {
    quality = "320k";
  }

  return {
    id: String(item.id),
    name: item.name ?? "",
    singer: (item.ar ?? item.artists ?? [])
      .map((a: any) => a?.name ?? "")
      .filter(Boolean)
      .join("、"),
    albumName: album.name ?? "",
    source: "wy",
    interval: Math.round((item.dt ?? item.duration ?? 0) / 1000),
    quality,
    img: album.picUrl ?? "",
  };
}

function mapWyPlaylist(item: any): PlaylistInfo {
  return {
    id: String(item.id),
    name: item.name ?? "",
    author: item.creator?.nickname ?? "",
    picUrl: item.coverImgUrl,
    desc: item.description,
    playCount: item.playCount,
    source: "wy",
  };
}

// ─── Provider ──────────────────────────────────────────

export const wyProvider: MusicSource = {
  id: "wy",
  name: "网易云音乐",
  supportedSearchTypes: ["song", "playlist", "album", "singer"],

  async search(keyword: string, type: SearchType, page = 1): Promise<SearchResult> {
    const limit = type === "playlist" ? 30 : 100;
    const offset = (page - 1) * limit;

    // cloudsearch type 映射：1=单曲 / 10=专辑 / 100=歌手 / 1000=歌单
    const typeMap: Record<SearchType, number> = {
      song: 1,
      album: 10,
      singer: 100,
      playlist: 1000,
    };

    const body = await eapiRequest("/api/cloudsearch/pc", {
      s: keyword,
      type: typeMap[type] ?? 1,
      limit,
      offset,
    });

    if (type === "song") {
      const rawSongs: any[] = body?.result?.songs ?? [];
      return { songs: rawSongs.map(mapWySong) };
    }

    if (type === "playlist") {
      const rawPlaylists: any[] = body?.result?.playlists ?? [];
      return { playlists: rawPlaylists.map(mapWyPlaylist) };
    }

    if (type === "singer") {
      const rawArtists: any[] = body?.result?.artists ?? [];
      return {
        artists: rawArtists.map((artist) => ({
          id: String(artist.id),
          name: String(artist.name ?? ""),
          picUrl: String(artist.picUrl ?? artist.img1v1Url ?? ""),
          alias: (artist.alias ?? []) as string[],
          musicSize: Number(artist.musicSize ?? 0),
          albumSize: Number(artist.albumSize ?? 0),
          source: "wy" as const,
        })),
      };
    }

    if (type === "album") {
      const rawAlbums: any[] = body?.result?.albums ?? [];
      return {
        albums: rawAlbums.map((album) => ({
          id: String(album.id),
          name: String(album.name ?? ""),
          picUrl: String(album.picUrl ?? album.blurPicUrl ?? ""),
          artist: String(album.artist?.name ?? album.artists?.[0]?.name ?? ""),
          artistId: String(album.artist?.id ?? album.artists?.[0]?.id ?? ""),
          publishTime: Number(album.publishTime ?? 0),
          trackCount: Number(album.size ?? 0),
          source: "wy" as const,
        })),
      };
    }

    return {};
  },

  async getMusicUrl(music: MusicInfo, quality = "320k"): Promise<string | null> {
    const idNum = parseInt(music.id, 10);
    if (isNaN(idNum)) return null;

    const levelMap: Record<string, string> = {
      "128k": "standard",
      "320k": "exhigh",
      flac: "lossless",
      hires: "hires",
    };
    const level = levelMap[quality] ?? "exhigh";

    // 1. 优先 weapi + Cookie（最可靠）
    try {
      await getWyCookie();
      const body = await weapiRequest("/song/enhance/player/url/v1", {
        ids: `[${idNum}]`,
        level,
        encodeType: "flac",
      });
      const url = body?.data?.[0]?.url as string | undefined;
      if (url && url.length > 0) return url;
    } catch {
      // weapi 失败，回退 eapi
    }

    // 2. 回退 eapi（免登录，部分免费歌曲可用）
    try {
      const br =
        quality === "flac" || quality === "hires"
          ? 999000
          : quality === "320k"
            ? 320000
            : 128000;
      const resp = await fetch(
        `https://interface3.music.163.com/eapi/song/enhance/player/url`,
        {
          method: "POST",
          headers: {
            "User-Agent": UA,
            Origin: "https://music.163.com",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `params=${encodeURIComponent(eapiEncrypt("/api/song/enhance/player/url", { ids: [idNum], br }))}`,
        }
      );
      const json: any = await resp.json();
      const url = json?.data?.[0]?.url as string | undefined;
      if (url && url.length > 0) return url;
    } catch {
      // eapi 也失败
    }

    return null;
  },

  async getMusicDetail(music: MusicInfo): Promise<MusicInfo> {
    return music;
  },

  async getLyric(music: MusicInfo) {
    try {
      const body = await eapiRequest("/api/song/lyric/v1", {
        id: parseInt(music.id, 10),
        cp: false,
        tv: 0,
        lv: 0,
        rv: 0,
        kv: 0,
        yv: 0,
        ytv: 0,
        yrv: 0,
      });

      return {
        lyric: (body?.lrc?.lyric as string) ?? undefined,
        tlyric: (body?.tlyric?.lyric as string) ?? undefined,
        romaLyric:
          (body?.romalrc?.lyric as string) ??
          (body?.yromalrc?.lyric as string) ??
          undefined,
        yrc: (body?.yrc?.lyric as string) ?? undefined,
      };
    } catch {
      return {};
    }
  },

  async getPlaylistDetail(playlist: PlaylistInfo): Promise<MusicInfo[]> {
    const idNum = parseInt(playlist.id, 10);
    if (isNaN(idNum)) return [];

    try {
      const cookie = await getWyCookie();
      if (cookie) {
        const body = await weapiRequest("/v3/playlist/detail", {
          id: idNum,
          n: 100000,
          s: 8,
        });
        const tracks: any[] = body?.playlist?.tracks ?? [];
        return tracks.map(mapWySong);
      }
    } catch {
      // weapi 失败，回退 linuxapi
    }

    // 回退 linuxapi（不需要 Cookie）
    try {
      const linuxApiKey = CryptoJS.enc.Utf8.parse("rFgB&h#%2?^eDg:Q");
      const linuxData = JSON.stringify({
        method: "POST",
        url: "https://music.163.com/api/v3/playlist/detail",
        params: { id: idNum, n: 100000, s: 8 },
      });
      const eparams = CryptoJS.AES.encrypt(
        CryptoJS.enc.Utf8.parse(linuxData),
        linuxApiKey,
        { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
      ).ciphertext.toString(CryptoJS.enc.Hex).toUpperCase();

      const resp = await fetch("https://music.163.com/api/linux/forward", {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `eparams=${encodeURIComponent(eparams)}`,
      });

      const json: any = await resp.json();
      if (json.code !== 200) return [];
      const tracks: any[] = json?.playlist?.tracks ?? [];
      return tracks.map(mapWySong);
    } catch {
      return [];
    }
  },
};
