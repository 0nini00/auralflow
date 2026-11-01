import type { MusicInfo } from "@lx/core";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import type { SearchAlbumResult } from "./musicApi";
import { mapWyTrackToMusicInfo } from "./wyMusicMapper";
import { getWyCookie } from "./wyAccountService";
import type { WyPlaylistInfo } from "./wyPlaylistService";

const WY_API_BASE = "https://music.163.com";
const WY_REQUEST_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": "AuralFlowMobile/0.1",
};

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | undefined {
  return value != null && typeof value === "object" ? value as JsonRecord : undefined;
}

export type WyHomeFeedErrorCode =
  | "WY_HTTP_ERROR"
  | "WY_API_ERROR"
  | "WY_INVALID_RESPONSE"
  | "WY_AUTH_REQUIRED";

export class WyHomeFeedError extends Error {
  readonly code: WyHomeFeedErrorCode;

  constructor(code: WyHomeFeedErrorCode, message: string) {
    super(message);
    this.name = "WyHomeFeedError";
    this.code = code;
  }
}

export async function getJson(path: string, cookie?: string | null): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${WY_API_BASE}${path}`, {
      headers: cookie ? { ...WY_REQUEST_HEADERS, Cookie: cookie } : WY_REQUEST_HEADERS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WyHomeFeedError("WY_HTTP_ERROR", `网易云请求失败：${message}`);
  }

  let data: JsonRecord;
  try {
    data = (await response.json()) as JsonRecord;
  } catch {
    throw new WyHomeFeedError("WY_INVALID_RESPONSE", "网易云返回了无效 JSON");
  }

  if (!response.ok) {
    throw new WyHomeFeedError("WY_HTTP_ERROR", `网易云请求失败，请稍后重试`);
  }
  if (data.code != null && data.code !== 200) {
    const message = typeof data.message === "string" ? data.message : `网易云接口错误 code=${String(data.code)}`;
    throw new WyHomeFeedError("WY_API_ERROR", message);
  }
  return data;
}

function positiveLimit(limit: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 10;
}

export function mapPlaylist(item: JsonRecord): WyPlaylistInfo {
  const creator = asRecord(item.creator);
  const cover = item.picUrl ?? item.coverImgUrl;
  return {
    id: String(item.id),
    name: String(item.name ?? "未命名歌单"),
    author: String(creator?.nickname ?? "网易云音乐"),
    picUrl: typeof cover === "string" ? cover : undefined,
    coverImgUrl: typeof cover === "string" ? cover : undefined,
    desc: typeof item.description === "string" ? item.description : undefined,
    playCount: Number(item.playCount ?? 0),
    trackCount: Number(item.trackCount ?? 0),
    source: "wy",
    subscribed: Boolean(item.subscribed),
    creator: creator?.userId == null ? undefined : {
      userId: String(creator.userId),
      nickname: String(creator.nickname ?? ""),
    },
  };
}

function mapAlbum(item: JsonRecord): SearchAlbumResult {
  const artists = Array.isArray(item.artists) ? item.artists : [];
  const artist = asRecord(item.artist) ?? asRecord(artists[0]);
  const publishTime = item.publishTime == null ? undefined : new Date(Number(item.publishTime));
  const cover = item.picUrl ?? item.blurPicUrl;
  return {
    id: String(item.id),
    name: String(item.name ?? "未命名专辑"),
    artistName: String(artist?.name ?? "未知歌手"),
    coverUrl: typeof cover === "string" ? cover : undefined,
    publishTime: publishTime && !Number.isNaN(publishTime.getTime())
      ? publishTime.toISOString().slice(0, 10)
      : undefined,
    trackCount: item.size == null ? undefined : Number(item.size),
    source: "wy",
  };
}

/** 取一页公开歌单（按分类）。它刻意不读也不要求 Cookie。 */
export async function fetchWyPlaylistPage(cat: string, limit = 10, offset = 0): Promise<WyPlaylistInfo[]> {
  const count = positiveLimit(limit);
  const params = new URLSearchParams({
    cat,
    order: "hot",
    limit: String(count),
    offset: String(Math.max(0, Math.floor(offset))),
  });
  const data = await getJson(`/api/playlist/list?${params.toString()}`);
  if (!Array.isArray(data.playlists)) {
    throw new WyHomeFeedError("WY_INVALID_RESPONSE", "网易云推荐歌单字段缺失");
  }
  return data.playlists.slice(0, count).map((item) => mapPlaylist(asRecord(item) ?? {}));
}

export async function fetchWyRecommendedPlaylists(limit = 10, offset = 0): Promise<WyPlaylistInfo[]> {
  return fetchWyPlaylistPage("全部", limit, offset);
}

/** 推荐歌单「每日一版」的候选分类：分类越多，轮换一轮需要的天数越久。 */
export const RECOMMENDED_POOL_CATEGORIES = ["全部", "华语", "流行", "电子", "民谣", "摇滚"] as const;

/**
 * 推荐歌单候选池。
 *
 * 只取热门前 N 条的话那个列表几天都不变，怎么刷新都是同一批；这里按分类各取一页、
 * 再给「全部」多取一页，去重后得到上百条候选，轮换才有原料。
 *
 * 单个分类失败不拖垮整池（`catch` 成 null），只有全部分类都失败才算失败。
 */
export async function fetchWyRecommendedPlaylistPool(pageSize = 24): Promise<WyPlaylistInfo[]> {
  const size = positiveLimit(pageSize);
  const requests = RECOMMENDED_POOL_CATEGORIES.flatMap((category, index) => {
    const offsets = index === 0 ? [0, size] : [0];
    return offsets.map((offset) =>
      fetchWyPlaylistPage(category, size, offset).catch(() => null),
    );
  });
  const pages = await Promise.all(requests);

  const seen = new Set<string>();
  const pool: WyPlaylistInfo[] = [];
  for (const page of pages) {
    for (const playlist of page ?? []) {
      const id = String(playlist.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      pool.push(playlist);
    }
  }
  if (pool.length === 0) throw new WyHomeFeedError("WY_INVALID_RESPONSE", "推荐歌单候选池为空");
  return pool;
}

export async function fetchWyPersonalizedRecommendedPlaylists(limit = 10): Promise<WyPlaylistInfo[]> {
  const cookie = await getWyCookie();
  if (!cookie) throw new WyHomeFeedError("WY_AUTH_REQUIRED", "网易云个性化推荐需要登录");
  const data = await getJson("/api/v1/discovery/recommend/resource", cookie);
  if (!Array.isArray(data.recommend)) {
    throw new WyHomeFeedError("WY_INVALID_RESPONSE", "网易云个性化推荐字段缺失");
  }
  return data.recommend.slice(0, positiveLimit(limit)).map((item) => mapPlaylist(asRecord(item) ?? {}));
}

export async function fetchWyNewSongs(limit = 10): Promise<MusicInfo[]> {
  const count = positiveLimit(limit);
  const params = new URLSearchParams({ limit: String(count) });
  const data = await getJson(`/api/personalized/newsong?${params.toString()}`);
  const songs = Array.isArray(data.result) ? data.result : null;
  if (!songs) throw new WyHomeFeedError("WY_INVALID_RESPONSE", "网易云新歌字段缺失");
  return songs.slice(0, count).map(mapWyTrackToMusicInfo);
}

export async function fetchWyNewAlbums(
  limit = 10,
  offset = 0,
  area = "ALL",
): Promise<SearchAlbumResult[]> {
  const count = positiveLimit(limit);
  const params = new URLSearchParams({
    limit: String(count),
    offset: String(Math.max(0, Math.floor(offset))),
    area,
  });
  const data = await getJson(`/api/album/new?${params.toString()}`);
  const albums = Array.isArray(data.albums) ? data.albums : null;
  if (!albums) throw new WyHomeFeedError("WY_INVALID_RESPONSE", "网易云新碟字段缺失");
  return albums.slice(0, count).map((item) => mapAlbum(asRecord(item) ?? {}));
}

export async function getPublicRecommendedPlaylists(limit = 12, offset = 0) { return fetchWyRecommendedPlaylists(limit, offset); }
export async function getPersonalizedRecommendedPlaylists(limit = 12) { return fetchWyPersonalizedRecommendedPlaylists(limit); }
export async function getNewSongs(limit = 20) { return fetchWyNewSongs(limit); }
export async function getNewAlbums(limit = 12, offset = 0, area = "ALL") { return fetchWyNewAlbums(limit, offset, area); }
