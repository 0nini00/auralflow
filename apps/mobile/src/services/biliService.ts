import AsyncStorage from "@react-native-async-storage/async-storage";
import CryptoJS from "crypto-js";
import type { MusicInfo, PlaylistInfo } from "@lx/core";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import { getSecureItem, removeSecureItem, setSecureItem } from "@/services/secureStorageService";
import { migrateLegacySecret } from "@/services/secureStorageMigrationModel";

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const BILI_COOKIE_KEY = "auralflow.mobile.bili.cookie";
const BILI_SECURE_COOKIE_KEY = "auralflow.mobile.bili.cookie.v1";
const API_BASE = "https://api.bilibili.com";
const BILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGE_SIZE = 20;
const MAX_LIST_PAGES = 50;
const WBI_KEY_TTL_MS = 12 * 60 * 60 * 1000;

const BILI_IMAGE_HOSTS = ["biliimg.com", "hdslb.com"];

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

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

interface BiliWbiKeys {
  imgKey: string;
  subKey: string;
  updatedAt: number;
}

interface BiliVideoPage {
  cid?: number;
  page?: number;
}

interface BiliDashAudio {
  baseUrl?: string;
  base_url?: string;
  bandwidth?: number;
}

interface BiliPlayUrlData {
  dash?: {
    audio?: BiliDashAudio[];
  };
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

interface BiliMusicExtra extends MusicInfo {
  aid?: string;
  bvid?: string;
  cid?: string;
}

/* ------------------------------------------------------------------ */
/* 图片 URL 归一化                                                      */
/* ------------------------------------------------------------------ */

function isBiliImageHost(host: string): boolean {
  return BILI_IMAGE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function normalizeImageUrl(src?: string | null): string {
  const value = src?.trim() ?? "";
  if (!value) return "";

  const normalized = value.startsWith("//") ? `https:${value}` : value;
  try {
    const url = new URL(normalized);
    if (isBiliImageHost(url.hostname) && url.protocol === "http:") {
      return url.toString().replace(/^http:/, "https:");
    }
    return url.toString();
  } catch {
    return normalized;
  }
}

export function isBiliImageUrl(src?: string | null): boolean {
  if (!src) return false;
  try {
    const normalized = src.startsWith("//") ? `https:${src}` : src;
    const host = new URL(normalized).hostname;
    return isBiliImageHost(host);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Cookie 管理                                                          */
/* ------------------------------------------------------------------ */

let cookieCache = "";

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

export async function saveBiliCookie(value: string): Promise<void> {
  cookieCache = normalizeBiliCookie(value);
  if (cookieCache) {
    await setSecureItem(BILI_SECURE_COOKIE_KEY, cookieCache);
    await AsyncStorage.removeItem(BILI_COOKIE_KEY);
  } else {
    await removeSecureItem(BILI_SECURE_COOKIE_KEY);
    await AsyncStorage.removeItem(BILI_COOKIE_KEY);
  }
}

export async function getBiliCookie(): Promise<string> {
  if (cookieCache) return cookieCache;
  const stored = await migrateLegacySecret({
    readSecure: () => getSecureItem(BILI_SECURE_COOKIE_KEY),
    readLegacy: () => AsyncStorage.getItem(BILI_COOKIE_KEY),
    writeSecure: (value) => setSecureItem(BILI_SECURE_COOKIE_KEY, value),
    removeLegacy: () => AsyncStorage.removeItem(BILI_COOKIE_KEY),
  });
  cookieCache = stored ? normalizeBiliCookie(stored) : "";
  return cookieCache;
}

export async function clearBiliCookie(): Promise<void> {
  await removeSecureItem(BILI_SECURE_COOKIE_KEY);
  await AsyncStorage.removeItem(BILI_COOKIE_KEY);
  cookieCache = "";
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                             */
/* ------------------------------------------------------------------ */

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ */
/* HTTP 请求                                                            */
/* ------------------------------------------------------------------ */

async function biliFetchJson<T>(
  url: string,
  referer = "https://www.bilibili.com/",
): Promise<T> {
  const requestCookie = await getBiliCookie();
  const headers: Record<string, string> = {
    "User-Agent": BILI_UA,
    Referer: referer,
    Accept: "application/json, text/plain, */*",
  };
  if (requestCookie) {
    headers["Cookie"] = requestCookie;
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { headers });
  } catch (error) {
    throw new Error(`B站请求失败：${getErrorMessage(error)}`);
  }

  if (!response.ok) {
    throw new Error(`B站请求失败，请稍后重试`);
  }

  const body = (await response.json()) as BiliApiResponse<T>;
  if (body.code !== 0) {
    throw new Error(body.message || "B站接口返回错误，请稍后重试");
  }
  return body.data as T;
}

async function biliJson<T>(
  path: string,
  params?: URLSearchParams,
  referer = "https://www.bilibili.com/",
): Promise<T> {
  const url = `${API_BASE}${path}${params ? `?${params.toString()}` : ""}`;
  return biliFetchJson<T>(url, referer);
}

/* ------------------------------------------------------------------ */
/* 账号校验                                                             */
/* ------------------------------------------------------------------ */

export async function checkBiliAccount(): Promise<BiliAccountInfo> {
  const data = await biliJson<Record<string, unknown>>("/x/web-interface/nav");
  if (!data?.isLogin) throw new Error("B站 Cookie 已过期或未登录");

  const uid = asString(data.mid);
  if (!uid) throw new Error("B站未返回用户 UID");
  const vipType =
    asNumber(data.vipType) ??
    asNumber((data.vip as Record<string, unknown> | undefined)?.type) ??
    0;
  const vipStatus =
    asNumber(data.vipStatus) ??
    asNumber((data.vip as Record<string, unknown> | undefined)?.status) ??
    0;

  return {
    uid,
    nickname: asString(data.uname),
    avatarUrl: normalizeImageUrl(asString(data.face)),
    vipType,
    isVip: vipStatus > 0 || vipType > 0,
  };
}

/* ------------------------------------------------------------------ */
/* WBI 签名                                                             */
/* ------------------------------------------------------------------ */

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

let cachedWbiKeys: BiliWbiKeys | null = null;

function getMixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((index) => raw[index] ?? "").join("").slice(0, 32);
}

function encodeWbiValue(value: unknown): string {
  return encodeURIComponent(String(value).replace(/[!'()*]/g, ""));
}

export function encWbi(
  params: Record<string, string | number | boolean>,
  imgKey: string,
  subKey: string,
): string {
  const signedParams: Record<string, string | number | boolean> = {
    ...params,
    wts: Math.round(Date.now() / 1000),
  };
  const query = Object.keys(signedParams)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeWbiValue(signedParams[key])}`)
    .join("&");
  const wRid = CryptoJS.MD5(query + getMixinKey(imgKey, subKey)).toString();
  return `${query}&w_rid=${wRid}`;
}

async function getWbiKeys(force = false): Promise<BiliWbiKeys> {
  const now = Date.now();
  if (!force && cachedWbiKeys && now - cachedWbiKeys.updatedAt < WBI_KEY_TTL_MS) {
    return cachedWbiKeys;
  }

  const data = await biliJson<{ wbi_img?: { img_url?: string; sub_url?: string } }>(
    "/x/web-interface/nav",
  );
  const imgUrl = data?.wbi_img?.img_url ?? "";
  const subUrl = data?.wbi_img?.sub_url ?? "";
  const imgKey = imgUrl.split("/").pop()?.split(".")[0] ?? "";
  const subKey = subUrl.split("/").pop()?.split(".")[0] ?? "";
  if (!imgKey || !subKey) throw new Error("B站未返回 WBI 签名参数");

  cachedWbiKeys = { imgKey, subKey, updatedAt: now };
  return cachedWbiKeys;
}

/* ------------------------------------------------------------------ */
/* 收藏合集拉取                                                         */
/* ------------------------------------------------------------------ */

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
    const data = await biliJson<BiliCollectedListData>(
      "/x/v3/fav/folder/collected/list",
      params,
      referer,
    );
    const list = Array.isArray(data?.list) ? data.list : [];
    total = asNumber(data?.count) ?? result.length + list.length;
    result.push(
      ...list.map(mapBiliCollection).filter((item): item is BiliCollectionInfo => item != null),
    );
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

/* ------------------------------------------------------------------ */
/* 合集歌曲拉取（三路回退）                                               */
/* ------------------------------------------------------------------ */

export async function getBiliCollectionSongs(collection: BiliCollectionInfo): Promise<MusicInfo[]> {
  const errors: string[] = [];

  try {
    const songs = await getBiliFavoriteResourceSongs(collection.id);
    if (songs.length > 0 || collection.mediaCount === 0) return songs;
  } catch (error) {
    errors.push(`收藏夹：${getErrorMessage(error)}`);
  }

  if (collection.creatorMid) {
    try {
      const songs = await getBiliSeasonArchiveSongs(collection.creatorMid, collection.id);
      if (songs.length > 0 || collection.mediaCount === 0) return songs;
    } catch (error) {
      errors.push(`合集：${getErrorMessage(error)}`);
    }

    try {
      const songs = await getBiliSeriesArchiveSongs(collection.creatorMid, collection.id);
      if (songs.length > 0 || collection.mediaCount === 0) return songs;
    } catch (error) {
      errors.push(`系列：${getErrorMessage(error)}`);
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
    songs.push(
      ...medias.map(mapBiliMediaToMusic).filter((item): item is MusicInfo => item != null),
    );
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
    const data = await biliJson<BiliSeasonArchivesData>(
      "/x/polymer/web-space/seasons_archives_list",
      params,
      referer,
    );
    const archives = Array.isArray(data?.archives) ? data.archives : [];
    songs.push(
      ...archives.map(mapBiliArchiveToMusic).filter((item): item is MusicInfo => item != null),
    );
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
    songs.push(
      ...archives.map(mapBiliArchiveToMusic).filter((item): item is MusicInfo => item != null),
    );
    const total = asNumber(data?.page?.total) ?? songs.length;
    if (songs.length >= total || archives.length === 0) break;
    page += 1;
  }

  return songs;
}

/* ------------------------------------------------------------------ */
/* 歌曲映射                                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* 视频搜索                                                             */
/* ------------------------------------------------------------------ */

/**
 * 去除 B站搜索结果标题中的 <em class="keyword">...</em> 高亮标签及 HTML 实体。
 */
function stripBiliEm(text: string): string {
  if (!text) return "";
  return text
    .replace(/<em[^>]*>/gi, "")
    .replace(/<\/em>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * 将 B站搜索返回的时长字符串（"mm:ss" / "h:mm:ss"）解析为秒数。
 * 若传入的是数字则直接返回。
 */
function parseBiliDuration(value: string | number | undefined): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

/**
 * 将 B站搜索接口的单条视频结果映射为 MusicInfo。
 * 搜索结果结构与收藏/合集不同：type 为 "video" 字符串、UP 主在 author 字段、
 * 封面在 pic 字段、时长为 "mm:ss" 字符串、标题带 <em> 高亮标签。
 */
function mapBiliSearchVideoToMusic(raw: unknown): MusicInfo | null {
  if (!isRecord(raw)) return null;
  // 搜索结果 type 为 "video" 字符串；仅保留视频类型
  const type = asString(raw.type);
  if (type && type !== "video") return null;
  const bvid = asString(raw.bvid);
  const aid = asString(raw.aid);
  const title = stripBiliEm(asString(raw.title));
  if (!bvid || !title) return null;
  const author = asString(raw.author);
  return createBiliMusic({
    aid,
    bvid,
    title,
    singer: author || "B站",
    cover: normalizeImageUrl(asString(raw.pic)),
    duration: parseBiliDuration(asString(raw.duration)) ?? asNumber(raw.duration) ?? 0,
  });
}

/**
 * 搜索 B站视频并映射为 MusicInfo 列表。
 * 调用 /x/web-interface/search/type 接口（search_type=video）。
 * 不带 Cookie 也可搜索，带 Cookie 结果更全。
 */
export async function searchBiliVideos(keyword: string, page: number = 1): Promise<MusicInfo[]> {
  const query = keyword.trim();
  if (!query) return [];

  const params = new URLSearchParams();
  params.set("search_type", "video");
  params.set("keyword", query);
  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));
  params.set("order", "totalrank");

  const data = await biliJson<{ result?: unknown[] | null }>(
    "/x/web-interface/search/type",
    params,
    "https://search.bilibili.com/",
  );

  const list = Array.isArray(data?.result) ? data.result : [];
  return list
    .map(mapBiliSearchVideoToMusic)
    .filter((item): item is MusicInfo => item != null);
}

/* ------------------------------------------------------------------ */
/* 播放 URL 解析                                                        */
/* ------------------------------------------------------------------ */

function getBvid(song: MusicInfo): string {
  const extra = song as BiliMusicExtra;
  return extra.bvid || song.id;
}

function getAid(song: MusicInfo): string {
  const extra = song as BiliMusicExtra;
  return extra.aid || "";
}

function getVideoReferer(bvid: string, aid: string): string {
  return bvid
    ? `https://www.bilibili.com/video/${bvid}`
    : `https://www.bilibili.com/video/av${aid}`;
}

async function getVideoCid(song: MusicInfo): Promise<string> {
  const extra = song as BiliMusicExtra;
  if (extra.cid) return String(extra.cid);

  const bvid = getBvid(song);
  const aid = getAid(song);
  const params = new URLSearchParams();
  if (bvid) params.set("bvid", bvid);
  if (!bvid && aid) params.set("aid", aid);
  if (!params.toString()) throw new Error("B站歌曲缺少 bvid/aid");

  const data = await biliJson<{ pages?: BiliVideoPage[] }>(
    `/x/web-interface/view?${params.toString()}`,
    undefined,
    getVideoReferer(bvid, aid),
  );
  const cid = data?.pages?.[0]?.cid;
  if (!cid) throw new Error("B站未返回视频 cid");
  extra.cid = String(cid);
  return String(cid);
}

function selectBestDashAudio(data: BiliPlayUrlData): BiliDashAudio | null {
  const audio = [...(data?.dash?.audio ?? [])].sort(
    (left, right) => (right.bandwidth ?? 0) - (left.bandwidth ?? 0),
  );
  return audio[0] ?? null;
}

function getDashAudioUrl(audio: BiliDashAudio | null): string {
  return audio?.baseUrl || audio?.base_url || "";
}

async function resolveLegacyPlayUrl(
  bvid: string,
  aid: string,
  cid: string,
  referer: string,
): Promise<string> {
  const params = new URLSearchParams();
  if (bvid) params.set("bvid", bvid);
  if (!bvid && aid) params.set("aid", aid);
  params.set("cid", cid);
  params.set("qn", "64");
  params.set("fnval", "16");
  params.set("fnver", "0");
  params.set("fourk", "0");

  const data = await biliJson<BiliPlayUrlData>(
    `/x/player/playurl?${params.toString()}`,
    undefined,
    referer,
  );
  const rawUrl = getDashAudioUrl(selectBestDashAudio(data));
  if (!rawUrl) throw new Error("普通 playurl 未返回音频流");
  return rawUrl;
}

async function resolveWbiPlayUrl(
  bvid: string,
  aid: string,
  cid: string,
  referer: string,
): Promise<string> {
  const keys = await getWbiKeys();
  const signedQuery = encWbi(
    {
      ...(bvid ? { bvid } : { aid }),
      cid,
      qn: 0,
      fnver: 0,
      fnval: 4048,
      fourk: 1,
    },
    keys.imgKey,
    keys.subKey,
  );

  const data = await biliJson<BiliPlayUrlData>(
    `/x/player/wbi/playurl?${signedQuery}`,
    undefined,
    referer,
  );
  const rawUrl = getDashAudioUrl(selectBestDashAudio(data));
  if (!rawUrl) throw new Error("WBI playurl 未返回音频流");
  return rawUrl;
}

async function resolveBiliPlaybackUrl(
  bvid: string,
  aid: string,
  cid: string,
  referer: string,
): Promise<string> {
  const errors: string[] = [];

  try {
    return await resolveLegacyPlayUrl(bvid, aid, cid, referer);
  } catch (error) {
    errors.push(`普通 playurl: ${getErrorMessage(error)}`);
  }

  try {
    return await resolveWbiPlayUrl(bvid, aid, cid, referer);
  } catch (error) {
    errors.push(`WBI playurl: ${getErrorMessage(error)}`);
  }

  throw new Error(`B站播放地址解析失败：${errors.join("；")}`);
}

/**
 * 解析 B站歌曲的播放 URL。
 * 返回音频流 URL 和需要附带的 Referer header。
 */
export async function resolveBiliSongUrl(
  song: MusicInfo,
): Promise<{ url: string; referer: string }> {
  const bvid = getBvid(song);
  const aid = getAid(song);
  const cid = await getVideoCid(song);
  const referer = getVideoReferer(bvid, aid);
  const url = await resolveBiliPlaybackUrl(bvid, aid, cid, referer);
  return { url, referer };
}
