import type { MusicInfo } from "@lx/core";
import { extractTxTrackMeta } from "@lx/core";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import type { SearchPlaylistResult } from "./musicApi";
import type { WyPlaylistInfo } from "./wyPlaylistService";

const MUSIC_U_API = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const PLAYLIST_DETAIL_API = "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg";
const DEFAULT_LIMIT = 30;

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Origin: "https://y.qq.com",
  Referer: "https://y.qq.com/",
};

const TX_APP_HEADERS: Record<string, string> = {
  "User-Agent": "okhttp/3.14.9",
  Cookie: "tmeLoginType=-1;",
};

export interface TxPlaylistRequestOptions {
  fetchJson?: (url: string, init?: RequestInit) => Promise<any>;
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
  if (url.startsWith("http://")) return `https://${url.slice("http://".length)}`;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function stripHtml(value: unknown): string | undefined {
  const text = asText(value).replace(/<[^>]+>/g, "").trim();
  return text || undefined;
}

function joinSingers(singers: unknown): string {
  if (!Array.isArray(singers)) return "未知歌手";
  return singers.map((singer) => asText((singer as any)?.name)).filter(Boolean).join("、") || "未知歌手";
}

function getMaxQuality(item: any): string {
  const file = item?.file ?? item?.songinfo?.file ?? {};
  const hasSize = (...keys: string[]) => keys.some((key) => Number(file[key] ?? item?.[key] ?? 0) > 0);
  if (hasSize("size_hires", "sizeHires", "size_hiresape")) return "flac24bit";
  if (hasSize("size_flac", "sizeflac", "sizeape")) return "flac";
  if (hasSize("size_320mp3", "size320", "size_320")) return "320k";
  if (hasSize("size_128mp3", "size128", "size_128")) return "128k";
  return "128k";
}

async function defaultFetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetchWithTimeout(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`QQ 音乐请求失败 HTTP ${response.status}: ${text.slice(0, 160)}`);
  }

  const trimmed = text.trim();
  if (!trimmed) throw new Error("QQ 音乐返回空响应");

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("QQ 音乐返回无法解析的 JSON");
  }
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

export function mapTxPlaylistResult(item: any): SearchPlaylistResult | null {
  const id = asText(item?.dissid ?? item?.tid ?? item?.id ?? item?.dirid).trim();
  const name = asText(item?.dissname ?? item?.name ?? item?.title).trim();
  if (!id || !name) return null;

  return {
    id,
    name,
    creatorName: asText(item?.creator?.name ?? item?.creator?.nick ?? item?.nickname ?? item?.author) || undefined,
    coverUrl: normalizeImageUrl(item?.imgurl ?? item?.logo ?? item?.picurl ?? item?.cover),
    trackCount: asNumber(item?.song_count ?? item?.songnum ?? item?.song_num ?? item?.total_song_num ?? item?.songCount),
    playCount: asNumber(item?.listennum ?? item?.visitnum ?? item?.listen_num ?? item?.playCount),
    source: "tx",
  };
}

export function mapTxPlaylistInfo(playlist: SearchPlaylistResult): WyPlaylistInfo {
  return {
    id: playlist.id,
    name: playlist.name,
    author: playlist.creatorName || "未知创建者",
    picUrl: playlist.coverUrl,
    coverImgUrl: playlist.coverUrl,
    trackCount: playlist.trackCount ?? 0,
    playCount: playlist.playCount,
    source: "tx",
  };
}

export function mapTxPlaylistSong(item: any): MusicInfo | null {
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
          : "")
  );

  return {
    id,
    name,
    singer: joinSingers(item?.singer ?? item?.singerlist ?? item?.singers),
    albumName: asText(album.name ?? item?.albumname ?? item?.albumName),
    source: "tx",
    interval: asNumber(item?.interval) ?? 0,
    quality: getMaxQuality(item),
    picUrl: image,
    img: image,
    // 注意：不挂 gateway。内置音乐 API 的 joox 源是 JOOX 平台（海外）专用，
    // 其 id 是 base64 格式，与 QQ 音乐 songmid 是两套完全不同的体系，
    // 挂 joox gateway 也无法解析 QQ 曲目（实测 URL/歌词均返回空）。
    // 因此 QQ 音乐歌曲在「纯网关」播放策略下不尝试解析，直接报清晰错误。
    // lx 自定义音源取链依赖 strMediaMid，映射阶段丢掉会导致脚本解析失败
    txMeta: extractTxTrackMeta(item),
  };
}

async function musicuRequest(body: unknown, options: TxPlaylistRequestOptions): Promise<any> {
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  return fetchJson(MUSIC_U_API, {
    method: "POST",
    headers: {
      ...TX_APP_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * QQ 音乐直连搜索单曲（musicu DoSearchForQQMusicLite，search_type=0，免登录）。
 *
 * 背景：移动端此前歌曲搜索只走第三方网关，网关不稳定/限流时返回空列表；
 * 此函数直连腾讯 musicu 接口，作为网关之后的兜底/元数据补全来源，
 * 与桌面端 txProvider.search → searchQqSongs 对齐。
 */
export async function searchTxSongs(
  keyword: string,
  limit = 30,
  options: TxPlaylistRequestOptions = {}
): Promise<MusicInfo[]> {
  const query = keyword.trim();
  if (!query) return [];

  const data = await musicuRequest({
    comm: {
      ct: 11,
      cv: "1003006",
      v: "1003006",
      os_ver: "15",
      tmeAppID: "qqmusiclight",
      nettype: "NETWORK_WIFI",
      uid: "0",
    },
    request: {
      method: "DoSearchForQQMusicLite",
      module: "music.search.SearchCgiService",
      param: {
        search_id: String(Math.floor(Math.random() * 100000000000000 + Date.now() % 86400000)),
        remoteplace: "search.android.keyboard",
        query: query.length > 60 ? query.slice(0, 60) : query,
        search_type: 0, // 0=单曲（对齐桌面 searchQqSongs）
        num_per_page: limit,
        page_num: 1,
        highlight: 0,
        nqc_flag: 0,
        page_id: 1,
        grp: 1,
      },
    },
  }, options);

  const bodyData = data?.request?.data?.body ?? data?.body ?? {};
  return firstArray(bodyData?.item_song, data?.item_song)
    .map(mapTxPlaylistSong)
    .filter((music): music is MusicInfo => music != null);
}

export async function searchTxPlaylists(
  keyword: string,
  options: TxPlaylistRequestOptions = {}
): Promise<SearchPlaylistResult[]> {
  const query = keyword.trim();
  if (!query) return [];

  const body = {
    comm: {
      ct: 11,
      cv: "1003006",
      v: "1003006",
      os_ver: "15",
      tmeAppID: "qqmusiclight",
      nettype: "NETWORK_WIFI",
      uid: "0",
    },
    request: {
      method: "DoSearchForQQMusicLite",
      module: "music.search.SearchCgiService",
      param: {
        search_id: String(Math.floor(Math.random() * 100000000000000 + Date.now() % 86400000)),
        remoteplace: "search.android.keyboard",
        query: query.length > 60 ? query.slice(0, 60) : query,
        search_type: 3,
        num_per_page: DEFAULT_LIMIT,
        page_num: 1,
        highlight: 0,
        nqc_flag: 0,
        page_id: 1,
        grp: 1,
      },
    },
  };

  const data = await musicuRequest(body, options);
  const bodyData = data?.request?.data?.body ?? data?.body ?? {};
  return firstArray(bodyData?.item_song, bodyData?.songlist, bodyData)
    .map(mapTxPlaylistResult)
    .filter((playlist): playlist is SearchPlaylistResult => playlist != null);
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

async function fetchPlaylistDetailViaLegacyApi(id: string, options: TxPlaylistRequestOptions): Promise<MusicInfo[]> {
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
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const data = await fetchJson(`${PLAYLIST_DETAIL_API}?${params}`, undefined);
  return extractPlaylistSongs(data)
    .map(mapTxPlaylistSong)
    .filter((music): music is MusicInfo => music != null);
}

async function fetchPlaylistDetailViaMusicu(id: string, options: TxPlaylistRequestOptions): Promise<MusicInfo[]> {
  const data = await musicuRequest({
    comm: { ct: 24, cv: 0 },
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
  }, options);
  return extractPlaylistSongs(data)
    .map(mapTxPlaylistSong)
    .filter((music): music is MusicInfo => music != null);
}


export async function resolveTxSongUrl(
  song: Pick<MusicInfo, "id" | "source" | "quality">,
  options: TxPlaylistRequestOptions = {}
): Promise<string> {
  if (song.source !== "tx") throw new Error("仅支持 QQ 音乐歌曲");
  const songmid = song.id.trim();
  if (!songmid) throw new Error("QQ 音乐歌曲缺少 songmid");

  const guid = String(Math.random() * 10000000).replace(".", "");
  const data = await musicuRequest({
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
  }, options);

  const midurlinfo = data?.req_0?.data?.midurlinfo ?? [];
  const sip = data?.req_0?.data?.sip ?? [];
  const purl = midurlinfo[0]?.purl;
  const server = sip[0];
  if (!purl || !server) throw new Error("QQ 音乐未返回可播放地址");
  return `${server}${purl}`;
}

export async function getTxPlaylistDetail(
  playlist: Pick<WyPlaylistInfo, "id" | "source" | "name">,
  options: TxPlaylistRequestOptions = {}
): Promise<MusicInfo[]> {
  if (playlist.source !== "tx") throw new Error("仅支持 QQ 音乐歌单");
  const playlistId = playlist.id.trim();
  if (!playlistId) return [];

  let legacyError: unknown;
  try {
    const songs = await fetchPlaylistDetailViaLegacyApi(playlistId, options);
    if (songs.length > 0) return songs;
  } catch (error) {
    legacyError = error;
  }

  try {
    return await fetchPlaylistDetailViaMusicu(playlistId, options);
  } catch (musicuError) {
    if (!legacyError) throw musicuError;
    const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError);
    const musicuMessage = musicuError instanceof Error ? musicuError.message : String(musicuError);
    throw new Error(`QQ 歌单详情 legacy 接口失败：${legacyMessage}; musicu 接口失败：${musicuMessage}`);
  }
}
