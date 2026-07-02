import type { MusicInfo, PlaylistInfo } from "@lx/core";
import { biliGetJson, loadSettings } from "@lx/tauri-bridge";
import { normalizeImageUrl } from "@/utils/imageReferrerPolicy";

export interface BiliAccountInfo {
  uid: string;
  nickname: string;
  avatarUrl: string;
  vipType: number;
  isVip: boolean;
}

export interface BiliCollectionInfo extends PlaylistInfo {
  source: "bili";
  creatorMid?: string;
  mediaCount?: number;
  state?: number;
}

interface BiliApiResponse<T> {
  code: number;
  message?: string;
  data?: T | null;
}

interface BiliCollectedListData {
  count?: number;
  list?: unknown[] | null;
}

interface BiliResourceListData {
  info?: Record<string, unknown>;
  medias?: unknown[];
  has_more?: boolean;
}

interface BiliSeasonArchivesData {
  archives?: unknown[];
  page?: {
    total?: number;
    page_num?: number;
    page_size?: number;
    num?: number;
    size?: number;
  };
}

const API_BASE = "https://api.bilibili.com";
const PAGE_SIZE = 20;
const MAX_LIST_PAGES = 50;

let cookie = "";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function normalizeBiliCookie(input: string): string {
  return input
    .replace(/^\s*cookie\s*:\s*/i, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^name\s+value\b/i.test(line))
    .map((line) => {
      const tabParts = line.split("\t").map((part) => part.trim());
      return tabParts.length >= 2 ? `${tabParts[0]}=${tabParts[1]}` : line;
    })
    .join("; ")
    .replace(/\bCookie\s*:\s*/gi, "")
    .replace(/;{2,}/g, ";")
    .replace(/\s*;\s*/g, "; ")
    .trim();
}

export function setBiliCookie(value: string): string {
  cookie = normalizeBiliCookie(value);
  return cookie;
}

export async function getBiliCookie(): Promise<string> {
  if (cookie) return cookie;
  try {
    const settings = await loadSettings();
    cookie = normalizeBiliCookie(settings.biliCookie ?? "");
  } catch {
    // settings 文件可能尚不存在
  }
  return cookie;
}

async function biliJson<T>(path: string, params?: URLSearchParams, referer = "https://www.bilibili.com/"): Promise<T> {
  const requestCookie = await getBiliCookie();
  const url = `${API_BASE}${path}${params ? `?${params.toString()}` : ""}`;
  let body: BiliApiResponse<T>;
  try {
    body = await biliGetJson<BiliApiResponse<T>>({
      url,
      cookie: requestCookie || null,
      referer,
    });
  } catch (error) {
    throw new Error(`B站请求失败: ${path}; ${error instanceof Error ? error.message : String(error)}`);
  }
  if (body.code !== 0) {
    throw new Error(body.message || `B站接口返回 code=${body.code}`);
  }
  return body.data as T;
}

export async function checkBiliAccount(): Promise<BiliAccountInfo> {
  const data = await biliJson<Record<string, unknown>>("/x/web-interface/nav");
  if (!data?.isLogin) throw new Error("B站 Cookie 已过期或未登录");

  const uid = asString(data.mid);
  if (!uid) throw new Error("B站未返回用户 UID");
  const vipType = asNumber(data.vipType) ?? asNumber((data.vip as Record<string, unknown> | undefined)?.type) ?? 0;
  const vipStatus = asNumber(data.vipStatus) ?? asNumber((data.vip as Record<string, unknown> | undefined)?.status) ?? 0;

  return {
    uid,
    nickname: asString(data.uname),
    avatarUrl: asString(data.face),
    vipType,
    isVip: vipStatus > 0 || vipType > 0,
  };
}

export async function getBiliSubscribedCollections(uid: string): Promise<BiliCollectionInfo[]> {
  const result: BiliCollectionInfo[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (result.length < total && page <= MAX_LIST_PAGES) {
    const params = new URLSearchParams();
    params.set("up_mid", uid);
    params.set("pn", String(page));
    params.set("ps", String(PAGE_SIZE));
    params.set("platform", "web");
    params.set("web_location", "333.1387");

    const referer = `https://space.bilibili.com/${encodeURIComponent(uid)}/favlist?ftype=collect`;
    const data = await biliJson<BiliCollectedListData>("/x/v3/fav/folder/collected/list", params, referer);
    const list = Array.isArray(data?.list) ? data.list : [];
    total = asNumber(data?.count) ?? result.length + list.length;
    result.push(...list.map(mapBiliCollection).filter((item): item is BiliCollectionInfo => item != null));
    if (list.length < PAGE_SIZE) break;
    page += 1;
  }

  return result.filter((item) => (item.mediaCount ?? 1) > 0 && item.state !== 1);
}

function mapBiliCollection(raw: unknown): BiliCollectionInfo | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id || raw.media_id || raw.season_id || raw.series_id);
  const title = asString(raw.title || raw.name);
  if (!id || !title) return null;

  const upper = isRecord(raw.upper) ? raw.upper : {};
  const mediaCount = asNumber(raw.media_count ?? raw.total);

  return {
    id,
    name: title,
    author: asString(upper.name),
    picUrl: normalizeImageUrl(asString(raw.cover || raw.pic)),
    desc: asString(raw.intro || raw.description),
    trackCount: mediaCount,
    mediaCount,
    source: "bili",
    creatorMid: asString(raw.mid || upper.mid),
    state: asNumber(raw.state),
  };
}

export async function getBiliCollectionSongs(collection: BiliCollectionInfo): Promise<MusicInfo[]> {
  const errors: string[] = [];

  try {
    const songs = await getBiliFavoriteResourceSongs(collection.id);
    if (songs.length > 0 || collection.mediaCount === 0) return songs;
  } catch (error) {
    errors.push(`收藏夹: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (collection.creatorMid) {
    try {
      const songs = await getBiliSeasonArchiveSongs(collection.creatorMid, collection.id);
      if (songs.length > 0 || collection.mediaCount === 0) return songs;
    } catch (error) {
      errors.push(`合集: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const songs = await getBiliSeriesArchiveSongs(collection.creatorMid, collection.id);
      if (songs.length > 0 || collection.mediaCount === 0) return songs;
    } catch (error) {
      errors.push(`系列: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join("\n") || "B站合集内容获取失败");
}

async function getBiliFavoriteResourceSongs(mediaId: string): Promise<MusicInfo[]> {
  const songs: MusicInfo[] = [];
  let page = 1;

  while (page <= MAX_LIST_PAGES) {
    const params = new URLSearchParams();
    params.set("media_id", mediaId);
    params.set("pn", String(page));
    params.set("ps", String(PAGE_SIZE));
    params.set("platform", "web");
    params.set("order", "mtime");

    const data = await biliJson<BiliResourceListData>("/x/v3/fav/resource/list", params);
    const medias = Array.isArray(data?.medias) ? data.medias : [];
    songs.push(...medias.map(mapBiliMediaToMusic).filter((item): item is MusicInfo => item != null));
    if (!data?.has_more || medias.length < PAGE_SIZE) break;
    page += 1;
  }

  return songs;
}

async function getBiliSeasonArchiveSongs(mid: string, seasonId: string): Promise<MusicInfo[]> {
  const songs: MusicInfo[] = [];
  let page = 1;

  while (page <= MAX_LIST_PAGES) {
    const params = new URLSearchParams();
    params.set("mid", mid);
    params.set("season_id", seasonId);
    params.set("sort_reverse", "false");
    params.set("page_num", String(page));
    params.set("page_size", "30");

    const referer = `https://space.bilibili.com/${encodeURIComponent(mid)}/channel/collectiondetail?sid=${encodeURIComponent(seasonId)}`;
    const data = await biliJson<BiliSeasonArchivesData>("/x/polymer/web-space/seasons_archives_list", params, referer);
    const archives = Array.isArray(data?.archives) ? data.archives : [];
    songs.push(...archives.map(mapBiliArchiveToMusic).filter((item): item is MusicInfo => item != null));
    const total = asNumber(data?.page?.total) ?? songs.length;
    if (songs.length >= total || archives.length === 0) break;
    page += 1;
  }

  return songs;
}

async function getBiliSeriesArchiveSongs(mid: string, seriesId: string): Promise<MusicInfo[]> {
  const songs: MusicInfo[] = [];
  let page = 1;

  while (page <= MAX_LIST_PAGES) {
    const params = new URLSearchParams();
    params.set("mid", mid);
    params.set("series_id", seriesId);
    params.set("only_normal", "true");
    params.set("sort", "desc");
    params.set("pn", String(page));
    params.set("ps", String(PAGE_SIZE));
    params.set("current_mid", mid);

    const data = await biliJson<BiliSeasonArchivesData>("/x/series/archives", params);
    const archives = Array.isArray(data?.archives) ? data.archives : [];
    songs.push(...archives.map(mapBiliArchiveToMusic).filter((item): item is MusicInfo => item != null));
    const total = asNumber(data?.page?.total) ?? songs.length;
    if (songs.length >= total || archives.length === 0) break;
    page += 1;
  }

  return songs;
}

export function mapBiliMediaToMusic(raw: unknown): MusicInfo | null {
  if (!isRecord(raw)) return null;
  if (asNumber(raw.type) !== 2) return null;
  const bvid = asString(raw.bvid || raw.bv_id);
  const aid = asString(raw.id);
  const title = asString(raw.title);
  if (!bvid || !title) return null;
  const upper = isRecord(raw.upper) ? raw.upper : {};
  return createBiliMusic({
    aid,
    bvid,
    title,
    singer: asString(upper.name) || "B站",
    cover: normalizeImageUrl(asString(raw.cover)),
    duration: asNumber(raw.duration) ?? 0,
  });
}

export function mapBiliArchiveToMusic(raw: unknown): MusicInfo | null {
  if (!isRecord(raw)) return null;
  const bvid = asString(raw.bvid);
  const aid = asString(raw.aid);
  const title = asString(raw.title);
  if (!bvid || !title) return null;
  return createBiliMusic({
    aid,
    bvid,
    title,
    singer: "B站",
    cover: normalizeImageUrl(asString(raw.pic)),
    duration: asNumber(raw.duration) ?? 0,
  });
}

function createBiliMusic(input: {
  aid: string;
  bvid: string;
  title: string;
  singer: string;
  cover: string;
  duration: number;
}): MusicInfo {
  return {
    id: input.bvid,
    name: input.title,
    singer: input.singer,
    albumName: "B站收藏合集",
    source: "bili",
    interval: input.duration,
    picUrl: normalizeImageUrl(input.cover),
    img: normalizeImageUrl(input.cover),
    aid: input.aid,
    bvid: input.bvid,
  } as MusicInfo & { aid: string; bvid: string };
}
