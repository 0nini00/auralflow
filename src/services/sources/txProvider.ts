import type {
  MusicInfo,
  MusicSource,
  PlaylistInfo,
  SearchResult,
  SearchType,
} from "@lx/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

// Tauri 环境用 plugin-http 绕过 CORS，纯 web dev 模式回退到 window.fetch
const safeFetch: typeof fetch = (...args) => {
  try {
    return tauriFetch(...args);
  } catch {
    return window.fetch(...args);
  }
};

// ─── QQ 音乐 API 端点 ─────────────────────────────

// 歌词
const LYRIC_API = "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg";

// 歌曲详情 + vkey（获取播放 URL）
const MUSIC_U_API = "https://u.y.qq.com/cgi-bin/musicu.fcg";

// 歌单详情（y.qq.com 页面同源公开接口）
const PLAYLIST_DETAIL_API = "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg";

// ─── 工具函数 ───────────────────────────────────────

function joinSingers(singers: any): string {
  if (!Array.isArray(singers)) return "";
  return singers
    .map((s) => s?.name ?? "")
    .filter(Boolean)
    .join("、");
}

function toSeconds(interval: number): number {
  return Math.round(interval);
}

function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function normalizeImageUrl(value: unknown): string | undefined {
  const url = asText(value).trim();
  if (!url) return undefined;
  return url.startsWith("//") ? `https:${url}` : url;
}

function stripHtml(value: unknown): string | undefined {
  const text = asText(value).replace(/<[^>]+>/g, "").trim();
  return text || undefined;
}

function parseQQText(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("QQ Music returned empty response");

  let jsonError: unknown;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    jsonError = error;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  const message = jsonError instanceof Error ? jsonError.message : String(jsonError);
  throw new Error(`QQ Music returned invalid JSON/JSONP: ${message}`);
}

function mapTxPlaylist(item: any): PlaylistInfo | null {
  const id = asText(item?.dissid ?? item?.tid ?? item?.id ?? item?.dirid).trim();
  const name = asText(item?.dissname ?? item?.name ?? item?.title).trim();
  if (!id || !name) return null;

  return {
    id,
    name,
    author: asText(item?.creator?.name ?? item?.creator?.nick ?? item?.nickname ?? item?.author),
    picUrl: normalizeImageUrl(item?.imgurl ?? item?.logo ?? item?.picurl ?? item?.cover),
    desc: stripHtml(item?.introduction ?? item?.dissdesc ?? item?.desc),
    playCount: asNumber(item?.listennum ?? item?.visitnum ?? item?.listen_num ?? item?.playCount),
    source: "tx",
  };
}

function mapTxSong(item: any): MusicInfo | null {
  const file = item?.file ?? item?.songinfo?.file ?? item ?? {};
  const album = item?.album ?? {};
  const mediaMid = file.media_mid ?? item?.strMediaMid ?? item?.media_mid;
  const id = asText(item?.mid ?? item?.songmid ?? mediaMid ?? item?.id ?? item?.songid ?? item?.songId).trim();
  const name = asText(item?.title ?? item?.name ?? item?.songname ?? item?.songName).trim();
  if (!id || !name) return null;

  const albumMid = asText(album.mid ?? album.pmid ?? item?.albummid ?? item?.albumMid);
  const singerMid = asText(item?.singer?.[0]?.mid ?? item?.singerlist?.[0]?.mid);
  const image = normalizeImageUrl(
    item?.img ??
      item?.picUrl ??
      (albumMid && albumMid !== "空"
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
        : singerMid
          ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg`
          : ""),
  );

  return {
    id,
    name,
    singer: joinSingers(item?.singer ?? item?.singerlist ?? item?.singers),
    albumName: asText(album.name ?? item?.albumname ?? item?.albumName),
    source: "tx",
    interval: toSeconds(asNumber(item?.interval) ?? 0),
    quality: getMaxQuality(item),
    picUrl: image,
    img: image,
  };
}

// ─── HTTP 封装 ───────────────────────────────────────

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Origin: "https://y.qq.com",
  Referer: "https://y.qq.com/",
};

const TX_APP_HEADERS: Record<string, string> = {
  "User-Agent": "okhttp/3.14.9",
  Cookie: "tmeLoginType=-1;",
};

async function qqFetch(url: string): Promise<any> {
  const resp = await safeFetch(url, { headers: COMMON_HEADERS });
  if (!resp.ok) {
    throw new Error(`QQ Music request failed: ${resp.status}`);
  }
  const text = await resp.text();
  return parseQQText(text);
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

async function qqMusicuRequest(method: string, module: string, param: Record<string, unknown>): Promise<any> {
  const payload = JSON.stringify({
    comm: {
      ct: 11,
      cv: "1003006",
      v: "1003006",
      os_ver: "15",
      phonetype: "24122RKC7C",
      rom: "Redmi/miro/miro:15/AE3A.240806.005/OS2.0.102.0.VOMCNXM:user/release-keys",
      tmeAppID: "qqmusiclight",
      nettype: "NETWORK_WIFI",
      udid: "0",
      uid: "0",
    },
    request: {
      method,
      module,
      param,
    },
  });

  const resp = await safeFetch(MUSIC_U_API, {
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
  const data = await resp.json();
  if (data?.code !== 0 || data?.request?.code !== 0) {
    throw new Error(`QQ Music request failed: code=${data?.code}, request=${data?.request?.code}`);
  }
  return data?.request?.data ?? data?.data ?? {};
}

async function qqSearch(
  keyword: string,
  page: number,
  limit: number,
  searchType: number,
): Promise<any> {
  return qqMusicuRequest("DoSearchForQQMusicLite", "music.search.SearchCgiService", {
    search_id: String(Math.floor(Math.random() * 100000000000000 + Date.now() % 86400000)),
    remoteplace: "search.android.keyboard",
    query: keyword.length > 60 ? keyword.slice(0, 60) : keyword,
    search_type: searchType,
    num_per_page: limit,
    page_num: page,
    highlight: 0,
    nqc_flag: 0,
    page_id: 1,
    grp: 1,
  });
}

function firstArray(...values: unknown[]): any[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
    const input = value as { list?: unknown; items?: unknown; v_item?: unknown } | null;
    if (Array.isArray(input?.list)) return input.list;
    if (Array.isArray(input?.items)) return input.items;
    if (Array.isArray(input?.v_item)) return input.v_item;
  }
  return [];
}

// ─── API 实现 ────────────────────────────────────────

async function searchSongs(
  keyword: string,
  page: number,
  limit: number
): Promise<MusicInfo[]> {
  const data = await qqSearch(keyword, page, limit, 0);
  const body = data?.body ?? {};
  const list = firstArray(body?.item_song, data?.item_song);
  return list
    .map(mapTxSong)
    .filter((music): music is MusicInfo => music != null);
}

async function searchPlaylists(
  keyword: string,
  page: number,
  limit: number
): Promise<PlaylistInfo[]> {
  const data = await qqSearch(keyword, page, limit, 3);
  const body = data?.body ?? {};
  const list = firstArray(
    body?.item_songlist,
    body?.item_playlist,
    body?.item_diss,
    data?.item_songlist,
    data?.item_playlist,
    data?.list,
  );
  return list
    .map(mapTxPlaylist)
    .filter((playlist): playlist is PlaylistInfo => playlist != null);
}

function getMaxQuality(item: any): string {
  // QQ Music returns size fields indicating available qualities
  const file = item.file ?? item.songinfo?.file ?? {};
  const size = (...keys: string[]) => keys.some((key) => Number(file[key] ?? item[key] ?? 0) > 0);
  if (size("size_hires", "sizeHires", "size_hiresape")) return "flac24bit";
  if (size("size_flac", "sizeflac", "sizeape")) return "flac";
  if (size("size_320mp3", "size320", "size_320")) return "320k";
  if (size("size_128mp3", "size128", "size_128")) return "128k";
  return "128k";
}

function extractPlaylistSongs(data: any): any[] {
  const candidates = [
    data?.cdlist?.[0]?.songlist,
    data?.req_0?.data?.songlist,
    data?.data?.songlist,
    data?.songlist,
  ];
  return candidates.find(Array.isArray) ?? [];
}

async function fetchPlaylistDetailViaLegacyApi(id: string): Promise<MusicInfo[]> {
  const params = new URLSearchParams({
    type: "1",
    json: "1",
    utf8: "1",
    onlysong: "0",
    new_format: "1",
    disstid: id,
    format: "json",
    g_tk: "5381",
    loginUin: "0",
    hostUin: "0",
    inCharset: "utf8",
    outCharset: "utf-8",
    notice: "0",
    platform: "yqq.json",
    needNewCode: "0",
  });
  const data = await qqFetch(`${PLAYLIST_DETAIL_API}?${params}`);
  return extractPlaylistSongs(data)
    .map(mapTxSong)
    .filter((music): music is MusicInfo => music != null);
}

async function fetchPlaylistDetailViaMusicu(id: string): Promise<MusicInfo[]> {
  const body = {
    comm: {
      ct: 24,
      cv: 0,
    },
    req_0: {
      module: "music.srfDissInfo.aiDissInfo",
      method: "uniform_get_Dissinfo",
      param: {
        disstid: id,
        tag: 1,
        userinfo: 1,
        song_begin: 0,
        song_num: 1000,
      },
    },
  };
  const data = await qqPost(MUSIC_U_API, body);
  return extractPlaylistSongs(data)
    .map(mapTxSong)
    .filter((music): music is MusicInfo => music != null);
}

async function getPlaylistSongs(id: string): Promise<MusicInfo[]> {
  const playlistId = id.trim();
  const emptySongs: MusicInfo[] = [];
  if (!playlistId) return emptySongs;

  let legacyError: unknown;
  try {
    const songs = await fetchPlaylistDetailViaLegacyApi(playlistId);
    if (songs.length > 0) return songs;
  } catch (error) {
    legacyError = error;
  }

  try {
    return await fetchPlaylistDetailViaMusicu(playlistId);
  } catch (musicuError) {
    if (legacyError) {
      const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError);
      const musicuMessage = musicuError instanceof Error ? musicuError.message : String(musicuError);
      throw new Error(`QQ 歌单详情 legacy 接口失败：${legacyMessage}\nQQ 歌单详情 musicu 接口失败：${musicuMessage}`);
    }
    throw musicuError;
  }
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
  supportedSearchTypes: ["song", "playlist"],

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

  async getPlaylistDetail(playlist: PlaylistInfo): Promise<MusicInfo[]> {
    return getPlaylistSongs(playlist.id);
  },
};
