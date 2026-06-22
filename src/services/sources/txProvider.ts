import type {
  MusicInfo,
  MusicSource,
  PlaylistInfo,
  SearchResult,
  SearchType,
} from "@lx/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import CryptoJS from "crypto-js";

// Tauri 环境用 plugin-http 绕过 CORS，纯 web dev 模式回退到 window.fetch
const safeFetch: typeof fetch = (...args) => {
  try {
    return tauriFetch(...args);
  } catch {
    return window.fetch(...args);
  }
};

// ─── QQ 音乐 API 端点 ─────────────────────────────

// 搜索（desktop 同款 SearchCgiService，需要 zzc 签名）
const SEARCH_API = "https://u.y.qq.com/cgi-bin/musics.fcg";

// 歌词
const LYRIC_API = "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg";

// 歌曲详情 + vkey（获取播放 URL）
const MUSIC_U_API = "https://u.y.qq.com/cgi-bin/musicu.fcg";

// ─── 工具函数 ───────────────────────────────────────

function joinSingers(singers: any[]): string {
  if (!Array.isArray(singers)) return "";
  return singers
    .map((s) => s?.name ?? "")
    .filter(Boolean)
    .join("、");
}

function toSeconds(interval: number): number {
  return Math.round(interval);
}

// ─── HTTP 封装 ───────────────────────────────────────

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://y.qq.com/",
};

const TX_APP_HEADERS: Record<string, string> = {
  "User-Agent": "QQMusic 14090508(android 12)",
};

const SIGN_PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19];
const SIGN_PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
const SIGN_SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];

function sha1Hex(text: string): string {
  return CryptoJS.SHA1(text).toString(CryptoJS.enc.Hex);
}

function pickHashByIndex(hash: string, indexes: number[]): string {
  return indexes.map((index) => hash[index]).join("");
}

function base64EncodeBytes(bytes: number[]): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/[\\/+=]/g, "");
}

function zzcSign(text: string): string {
  const hash = sha1Hex(text);
  const part1 = pickHashByIndex(hash, SIGN_PART_1_INDEXES);
  const part2 = pickHashByIndex(hash, SIGN_PART_2_INDEXES);
  const scrambled = SIGN_SCRAMBLE_VALUES.map((value, index) => (
    value ^ parseInt(hash.slice(index * 2, index * 2 + 2), 16)
  ));
  return `zzc${part1}${base64EncodeBytes(scrambled)}${part2}`.toLowerCase();
}

async function qqFetch(url: string): Promise<any> {
  const resp = await safeFetch(url, { headers: COMMON_HEADERS });
  if (!resp.ok) {
    throw new Error(`QQ Music request failed: ${resp.status}`);
  }
  const text = await resp.text();
  // QQ Music lyric API returns JSONP for some endpoints
  if (text.startsWith("jsonp")) {
    const jsonStr = text.replace(/^jsonp\d+\(/, "").replace(/\);?$/, "");
    return JSON.parse(jsonStr);
  }
  return JSON.parse(text);
}

async function qqPost(url: string, body: unknown): Promise<any> {
  const resp = await safeFetch(url, {
    method: "POST",
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`QQ Music request failed: ${resp.status}`);
  }
  return resp.json();
}

async function qqSignedPost(body: unknown): Promise<any> {
  const payload = JSON.stringify(body);
  const sign = zzcSign(payload);

  const resp = await safeFetch(`${SEARCH_API}?sign=${sign}`, {
    method: "POST",
    headers: {
      ...TX_APP_HEADERS,
      "Content-Type": "application/json",
    },
    body: payload,
  });
  if (!resp.ok) {
    throw new Error(`QQ Music request failed: ${resp.status}`);
  }
  return resp.json();
}

// ─── API 实现 ────────────────────────────────────────

async function searchSongs(
  keyword: string,
  page: number,
  limit: number
): Promise<MusicInfo[]> {
  const body = {
    comm: {
      ct: "11",
      cv: "14090508",
      v: "14090508",
      tmeAppID: "qqmusic",
      phonetype: "EBG-AN10",
      deviceScore: "553.47",
      devicelevel: "50",
      newdevicelevel: "20",
      rom: "HuaWei/EMOTION/EmotionUI_14.2.0",
      os_ver: "12",
      OpenUDID: "0",
      OpenUDID2: "0",
      QIMEI36: "0",
      udid: "0",
      chid: "0",
      aid: "0",
      oaid: "0",
      taid: "0",
      tid: "0",
      wid: "0",
      uid: "0",
      sid: "0",
      modeSwitch: "6",
      teenMode: "0",
      ui_mode: "2",
      nettype: "1020",
      v4ip: "",
    },
    req: {
      module: "music.search.SearchCgiService",
      method: "DoSearchForQQMusicMobile",
      param: {
        search_type: 0,
        searchid: Math.random().toString().slice(2),
        query: keyword,
        page_num: page,
        num_per_page: limit,
        highlight: 0,
        nqc_flag: 0,
        multi_zhida: 0,
        cat: 2,
        grp: 1,
        sin: 0,
        sem: 0,
      },
    },
  };

  const data = await qqSignedPost(body);
  if (data?.code !== 0 || data?.req?.code !== 0) {
    throw new Error(`QQ Music search failed: code=${data?.code}, req=${data?.req?.code}`);
  }

  const list = data?.req?.data?.body?.item_song ?? [];

  return list
    .filter((item: any) => item?.file?.media_mid)
    .map((item: any) => {
      const album = item.album ?? {};
      const albumMid = album.mid ?? "";
      const singerMid = item.singer?.[0]?.mid ?? "";
      return {
        id: item.mid ?? item.file.media_mid ?? String(item.id),
        name: item.title ?? item.name ?? "",
        singer: joinSingers(item.singer),
        albumName: album.name ?? "",
        source: "tx" as const,
        interval: toSeconds(item.interval ?? 0),
        quality: getMaxQuality(item),
        img: albumMid && albumMid !== "空"
          ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
          : singerMid
            ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg`
            : "",
      };
    });
}

async function searchPlaylists(
  _keyword: string,
  _page: number,
  _limit: number
): Promise<PlaylistInfo[]> {
  // QQ 歌单搜索和详情需要单独接 musics.fcg 模块，先避免继续调用会 400 的旧接口。
  return [];
}

function getMaxQuality(item: any): string {
  // QQ Music returns size fields indicating available qualities
  const file = item.file ?? item.songinfo?.file ?? {};
  if (file.size_hires > 0) return "flac24bit";
  if (file.size_flac > 0) return "flac";
  if (file.size_320mp3 > 0) return "320k";
  if (file.size_128mp3 > 0) return "128k";
  return "128k";
}

async function getSongUrl(songmid: string, _quality?: string): Promise<string | null> {
  const guid = String(Math.random() * 10000000).replace(".", "");

  const body = {
    req_0: {
      module: "vkey.GetVkeyServer",
      method: "CgiGetVkey",
      param: {
        guid,
        songmid: [songmid],
        songtype: [0],
        uin: "0",
        loginflag: 0,
        platform: "20",
      },
    },
  };

  const data = await qqPost(MUSIC_U_API, body);
  const midurlinfo = data?.req_0?.data?.midurlinfo ?? [];
  const sip = data?.req_0?.data?.sip ?? [];

  if (midurlinfo.length === 0 || sip.length === 0) return null;

  const info = midurlinfo[0];
  if (!info.purl || info.purl === "") return null;

  const server = sip[0];
  return `${server}${info.purl}`;
}

async function getLyric(songmid: string): Promise<{ lyric?: string; tlyric?: string }> {
  const params = new URLSearchParams({
    songmid,
    format: "json",
    nobase64: "1",
  });

  const data = await qqFetch(`${LYRIC_API}?${params}`);
  return {
    lyric: data?.lyric ?? undefined,
    tlyric: data?.trans ?? undefined,
  };
}

export const txProvider: MusicSource = {
  id: "tx",
  name: "QQ 音乐",
  // QQ 音乐当前只接入单曲搜索，不声明其他类型以避免空结果误导用户。
  supportedSearchTypes: ["song"],

  async search(keyword: string, type: SearchType, page = 1): Promise<SearchResult> {
    if (type === "song") {
      const songs = await searchSongs(keyword, page, 50);
      return { songs };
    }

    if (type === "playlist") {
      const playlists = await searchPlaylists(keyword, page, 30);
      return { playlists };
    }

    return {};
  },

  async getMusicUrl(music: MusicInfo, _quality?: string): Promise<string | null> {
    return getSongUrl(music.id);
  },

  async getMusicDetail(music: MusicInfo): Promise<MusicInfo> {
    return music;
  },

  async getLyric(music: MusicInfo): Promise<{ lyric?: string; tlyric?: string }> {
    return getLyric(music.id);
  },

  async getPlaylistDetail(_playlist: PlaylistInfo): Promise<MusicInfo[]> {
    // QQ Music playlist detail requires a different API that needs authentication
    // Return empty for now - users can still search and play individual songs
    console.warn("[txProvider] playlist detail not yet implemented for QQ Music");
    return [];
  },
};
