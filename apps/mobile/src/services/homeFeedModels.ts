import type { MusicInfo } from "@lx/core";
import type { SearchAlbumResult } from "./musicApi";
import type { WyPlaylistInfo } from "./wyPlaylistService";

export type HomeSectionId =
  | "quickActions"
  | "recommendedPlaylists"
  | "dailySongs"
  | "newSongs"
  | "newAlbums"
  | "recentHistory";

export type HomeFeedSectionId = Exclude<HomeSectionId, "quickActions" | "recentHistory">;
export type HomeSectionKind = HomeFeedSectionId;
export type HomeSectionStatus = "idle" | "loading" | "ready" | "refreshing" | "error";

export interface HomeFeedError {
  kind: "network" | "auth" | "invalid" | "unknown";
  message: string;
}

export interface HomeSectionItems {
  recommendedPlaylists: WyPlaylistInfo[];
  dailySongs: MusicInfo[];
  newSongs: MusicInfo[];
  newAlbums: SearchAlbumResult[];
}

export interface HomeSectionBase<K extends HomeFeedSectionId> {
  id: K;
  kind: K;
  title: string;
  status: HomeSectionStatus;
  items: HomeSectionItems[K];
  error: HomeFeedError | null;
  updatedAt: number | null;
}

export type HomeFeedSectionById<K extends HomeFeedSectionId> = {
  [P in K]: HomeSectionBase<P>;
}[K];

export type HomeFeedSection = HomeFeedSectionById<HomeFeedSectionId>;

export interface HomeFeedSnapshot {
  scopeKey: string;
  fetchedAt: number;
  sections: HomeFeedSection[];
}

export interface HomeFeedContext {
  scopeKey: string;
  isLoggedIn: boolean;
}

export const HOME_FEED_TTL_MS = 10 * 60 * 1000;
export const HOME_FEED_CACHE_PREFIX = "auralflow.mobile.homeFeed.v1:";
export const HOME_FEED_SECTION_ORDER: readonly HomeSectionId[] = [
  "quickActions",
  "recommendedPlaylists",
  "dailySongs",
  "newSongs",
  "newAlbums",
  "recentHistory",
];

// 首页远程区块顺序。新歌/新碟已由「排行榜」区块取代（见 LeaderboardScreen），
// 不再作为 homeFeed 区块拉取，减少启动请求；类型定义保留以兼容缓存旧数据。
export const HOME_FEED_REMOTE_SECTION_ORDER: readonly HomeFeedSectionId[] = [
  "recommendedPlaylists",
  "dailySongs",
];

export const HOME_FEED_SECTION_TITLES: Record<HomeFeedSectionId, string> = {
  recommendedPlaylists: "推荐歌单",
  dailySongs: "每日推荐",
  newSongs: "新歌",
  newAlbums: "新碟",
};

const HOME_FEED_SECTION_STATUSES: readonly HomeSectionStatus[] = [
  "idle",
  "loading",
  "ready",
  "refreshing",
  "error",
];
const HOME_FEED_ERROR_KINDS: readonly HomeFeedError["kind"][] = [
  "network",
  "auth",
  "invalid",
  "unknown",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function hasStringFields(value: unknown, fields: readonly string[]): boolean {
  return isRecord(value) && fields.every((field) => typeof value[field] === "string" && value[field].length > 0);
}

function isMusicInfo(value: unknown): boolean {
  return hasStringFields(value, ["id", "name", "source", "singer"])
    && isRecord(value)
    && typeof value.albumName === "string";
}

function isRecommendedPlaylist(value: unknown): boolean {
  return hasStringFields(value, ["id", "name", "author", "source"])
    && isRecord(value)
    && typeof value.trackCount === "number"
    && Number.isFinite(value.trackCount);
}

function isSearchAlbumResult(value: unknown): boolean {
  return hasStringFields(value, ["id", "name", "artistName", "source"]);
}

function isHomeSectionItem(kind: HomeFeedSectionId, value: unknown): boolean {
  switch (kind) {
    case "recommendedPlaylists":
      return isRecommendedPlaylist(value);
    case "dailySongs":
    case "newSongs":
      return isMusicInfo(value);
    case "newAlbums":
      return isSearchAlbumResult(value);
  }
}

function isHomeFeedSectionId(value: unknown): value is HomeFeedSectionId {
  return typeof value === "string"
    && HOME_FEED_REMOTE_SECTION_ORDER.some((id) => id === value);
}

function isHomeFeedError(value: unknown): value is HomeFeedError {
  if (!isRecord(value)) return false;
  return typeof value.kind === "string"
    && HOME_FEED_ERROR_KINDS.some((kind) => kind === value.kind)
    && typeof value.message === "string";
}

export function isHomeFeedSection(value: unknown): value is HomeFeedSection {
  if (!isRecord(value)) return false;
  const sectionId = value.id;
  return isHomeFeedSectionId(sectionId)
    && value.kind === sectionId
    && typeof value.title === "string"
    && typeof value.status === "string"
    && HOME_FEED_SECTION_STATUSES.some((status) => status === value.status)
    && Array.isArray(value.items)
    && value.items.every((item) => isHomeSectionItem(sectionId, item))
    && (value.error === null || isHomeFeedError(value.error))
    && (value.updatedAt === null
      || (typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)));
}

export function getHomeFeedScope(userId: string | null | undefined): string {
  const normalized = userId == null ? "" : String(userId).trim();
  return normalized ? `wy:${normalized}` : "anonymous";
}

export function getHomeFeedCacheKey(scopeKey: string): string {
  return `${HOME_FEED_CACHE_PREFIX}${scopeKey}`;
}

export function isHomeFeedSnapshot(value: unknown, scopeKey: string): value is HomeFeedSnapshot {
  if (!isRecord(value)) return false;
  return value.scopeKey === scopeKey
    && typeof value.fetchedAt === "number"
    && Number.isFinite(value.fetchedAt)
    && Array.isArray(value.sections)
    && value.sections.every(isHomeFeedSection);
}
