import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MusicInfo } from "@lx/core";

/**
 * 移动端持久化播放 URL 缓存。
 * 对齐桌面端 desktop/src/services/persistentCache.ts 的 getCachedPlaybackUrl /
 * saveCachedPlaybackUrl / invalidateCachedPlaybackUrl，后端从 Tauri library 改为
 * AsyncStorage（移动端唯一可靠的持久化键值存储）。解析成功的 URL 落盘，
 * 冷启动 / 重启 app 后无需重新请求网关，节省流量与首播延迟。
 */

const STORAGE_KEY = "auralflow:playback-url-cache:v1";

export const PLAYBACK_URL_TTL_MS = 6 * 60 * 60 * 1000;
export const BILI_PLAYBACK_URL_TTL_MS = 30 * 60 * 1000;
export const LOCAL_PLAYBACK_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const CACHE_VERSION = 1;
const MAX_PLAYBACK_URL_ENTRIES = 500;

interface CachedPlaybackUrlEntry {
  url: string;
  music: MusicInfo;
  quality: string;
  /** B站等需要带请求头的音源，缓存时一并保存以命中即播 */
  headers?: Record<string, string>;
  cachedAt: number;
  expiresAt: number;
}

interface PlaybackUrlCacheState {
  version: number;
  playbackUrls: Record<string, CachedPlaybackUrlEntry>;
}

export interface CachedPlaybackUrl {
  url: string;
  quality: string;
  headers?: Record<string, string>;
  fromCache: true;
}

function createEmptyCache(): PlaybackUrlCacheState {
  return { version: CACHE_VERSION, playbackUrls: {} };
}

function normalizeCache(value: unknown): PlaybackUrlCacheState {
  if (!value || typeof value !== "object") return createEmptyCache();
  const record = value as Record<string, unknown>;
  if (record.version !== CACHE_VERSION) return createEmptyCache();
  const playbackUrls =
    record.playbackUrls && typeof record.playbackUrls === "object"
      ? (record.playbackUrls as Record<string, CachedPlaybackUrlEntry>)
      : {};
  return { version: CACHE_VERSION, playbackUrls };
}

let cachePromise: Promise<PlaybackUrlCacheState> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function loadCache(): Promise<PlaybackUrlCacheState> {
  if (!cachePromise) {
    cachePromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => (raw ? normalizeCache(JSON.parse(raw)) : createEmptyCache()))
      .catch((error) => {
        console.warn("[playbackUrlCache] 加载失败，重置:", error);
        cachePromise = null;
        return createEmptyCache();
      });
  }
  return cachePromise;
}

function getTrackKey(music: Pick<MusicInfo, "source" | "id">): string {
  return `${music.source}:${music.id}`;
}

function getCacheKey(music: Pick<MusicInfo, "source" | "id">, quality: string): string {
  return `${getTrackKey(music)}:${quality}`;
}

function ttlFor(music: MusicInfo, url: string): number {
  if (url.startsWith("file://") || music.source === "local") return LOCAL_PLAYBACK_CACHE_TTL_MS;
  if (music.source === "bili") return BILI_PLAYBACK_URL_TTL_MS;
  return PLAYBACK_URL_TTL_MS;
}

function prune(cache: PlaybackUrlCacheState, now: number): void {
  for (const [key, entry] of Object.entries(cache.playbackUrls)) {
    if (!entry || entry.expiresAt <= now) delete cache.playbackUrls[key];
  }
  const remaining = Object.entries(cache.playbackUrls);
  if (remaining.length <= MAX_PLAYBACK_URL_ENTRIES) return;
  remaining
    .sort(([, left], [, right]) => right.cachedAt - left.cachedAt)
    .slice(MAX_PLAYBACK_URL_ENTRIES)
    .forEach(([key]) => delete cache.playbackUrls[key]);
}

async function saveCache(cache: PlaybackUrlCacheState, now = Date.now()): Promise<void> {
  prune(cache, now);
  const snapshot = JSON.stringify(cache);
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(STORAGE_KEY, snapshot));
  await writeQueue;
}

export function normalizeQualityKey(quality: string): string {
  const trimmed = quality.trim().toLowerCase();
  if (trimmed === "999") return "flac24bit";
  if (trimmed === "740") return "flac";
  if (/^\d+$/.test(trimmed)) return `${trimmed}k`;
  return trimmed;
}

/** 提取搜索去重后的多源变体（对齐桌面端 variants[]），扩大缓存命中面。 */
function getVariants(song: MusicInfo): MusicInfo[] {
  const variants = (song as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return [song];
  const seen = new Set<string>([getTrackKey(song)]);
  const result: MusicInfo[] = [song];
  for (const variant of variants as MusicInfo[]) {
    if (!variant?.source || !variant.id) continue;
    const key = getTrackKey(variant);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(variant);
  }
  return result;
}

/**
 * 按音质降级链查询持久化 URL 缓存。命中即返回（含请求头），
 * 过期条目就地清理。variants 缺省时从 song.variants 推断。
 */
export async function getCachedPlaybackUrl(
  song: MusicInfo,
  qualityPreference: string[],
  variants?: MusicInfo[],
  now = Date.now(),
): Promise<CachedPlaybackUrl | null> {
  const cache = await loadCache();
  const candidates = variants && variants.length ? variants : getVariants(song);

  for (const music of candidates) {
    for (const quality of qualityPreference) {
      const key = getCacheKey(music, normalizeQualityKey(quality));
      const entry = cache.playbackUrls[key];
      if (!entry) continue;
      if (entry.expiresAt <= now) {
        delete cache.playbackUrls[key];
        void saveCache(cache, now);
        continue;
      }
      return {
        url: entry.url,
        quality: entry.quality,
        headers: entry.headers,
        fromCache: true,
      };
    }
  }

  return null;
}

/**
 * 写入持久化 URL 缓存。同时以歌曲主键与解析出的真实源（可能是 variant）建索引，
 * 提升后续命中率（对齐桌面端 saveCachedPlaybackUrl 的双键写入）。
 */
export async function saveCachedPlaybackUrl(
  song: MusicInfo,
  resolved: { url: string; quality: string; headers?: Record<string, string> },
  now = Date.now(),
): Promise<void> {
  const cache = await loadCache();
  const qualityKey = normalizeQualityKey(resolved.quality);
  const entry: CachedPlaybackUrlEntry = {
    url: resolved.url,
    music: song,
    quality: qualityKey,
    headers: resolved.headers,
    cachedAt: now,
    expiresAt: now + ttlFor(song, resolved.url),
  };

  cache.playbackUrls[getCacheKey(song, qualityKey)] = entry;
  cache.playbackUrls[getCacheKey({ source: song.source, id: song.id }, qualityKey)] = entry;
  await saveCache(cache, now);
}

export async function invalidateCachedPlaybackUrl(
  music: MusicInfo,
  quality?: string,
): Promise<void> {
  const cache = await loadCache();
  const prefix = `${getTrackKey(music)}:`;
  let changed = false;

  if (quality) {
    const key = getCacheKey(music, normalizeQualityKey(quality));
    changed = key in cache.playbackUrls;
    delete cache.playbackUrls[key];
  } else {
    for (const key of Object.keys(cache.playbackUrls)) {
      if (!key.startsWith(prefix)) continue;
      delete cache.playbackUrls[key];
      changed = true;
    }
  }

  if (changed) await saveCache(cache);
}

export function resetPlaybackUrlCacheMemory(): void {
  // 置空而非预填空缓存：下次访问会重新从 AsyncStorage 加载，
  // 与冷启动（进程重启后 cachePromise 自然为 null）行为一致。
  cachePromise = null;
}

export async function clearPlaybackUrlCache(): Promise<void> {
  resetPlaybackUrlCacheMemory();
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
}
