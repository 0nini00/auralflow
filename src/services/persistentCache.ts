import type { MusicInfo } from '@lx/core';
import { libraryLoad, librarySave } from '@lx/tauri-bridge';
import type { LyricResponse } from '@/services/lyrics/parserCore';
import type { PlaybackBackendId, PlaybackResolvedUrl } from '@/services/playback/types';

const CACHE_NAMESPACE = 'cache';

export const PLAYBACK_URL_TTL_MS = 6 * 60 * 60 * 1000;
export const BILI_PLAYBACK_URL_TTL_MS = 30 * 60 * 1000;
export const LYRIC_FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LYRIC_EMPTY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CACHE_VERSION = 1;
const MAX_PLAYBACK_URL_ENTRIES = 500;
const MAX_LYRIC_ENTRIES = 1000;
const CACHEABLE_EMPTY_LYRIC_ERRORS = new Set([
  '暂无歌词',
  '未找到匹配歌曲',
  '不支持的音源',
  '歌曲信息不完整',
]);

interface CachedPlaybackUrlEntry {
  url: string;
  music: MusicInfo;
  quality: string;
  backend: PlaybackBackendId;
  resolverName: string;
  cachedAt: number;
  expiresAt: number;
}

interface CachedLyricEntry {
  response: LyricResponse;
  cachedAt: number;
  expiresAt: number;
}

interface PersistentCacheState {
  version: number;
  playbackUrls: Record<string, CachedPlaybackUrlEntry>;
  lyrics: Record<string, CachedLyricEntry>;
}

function createEmptyCache(): PersistentCacheState {
  return {
    version: CACHE_VERSION,
    playbackUrls: {},
    lyrics: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCache(value: unknown): PersistentCacheState {
  if (!isRecord(value) || value.version !== CACHE_VERSION) return createEmptyCache();
  return {
    version: CACHE_VERSION,
    playbackUrls: isRecord(value.playbackUrls)
      ? value.playbackUrls as Record<string, CachedPlaybackUrlEntry>
      : {},
    lyrics: isRecord(value.lyrics)
      ? value.lyrics as Record<string, CachedLyricEntry>
      : {},
  };
}

let cachePromise: Promise<PersistentCacheState> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function loadCache(): Promise<PersistentCacheState> {
  if (!cachePromise) {
    cachePromise = libraryLoad<PersistentCacheState>(CACHE_NAMESPACE)
      .then(normalizeCache)
      .catch((error) => {
        cachePromise = null;
        throw error;
      });
  }
  return cachePromise;
}

function pruneRecord<T extends { cachedAt: number }>(
  record: Record<string, T>,
  maxEntries: number,
  now: number,
): void {
  for (const [key, entry] of Object.entries(record)) {
    if (!entry || !Number.isFinite(entry.cachedAt)) {
      delete record[key];
      continue;
    }
    if ('expiresAt' in entry && Number((entry as T & { expiresAt?: number }).expiresAt) <= now) {
      delete record[key];
    }
  }

  const entries = Object.entries(record);
  if (entries.length <= maxEntries) return;

  entries
    .sort(([, left], [, right]) => right.cachedAt - left.cachedAt)
    .slice(maxEntries)
    .forEach(([key]) => {
      delete record[key];
    });
}

async function saveCache(cache: PersistentCacheState, now = Date.now()): Promise<void> {
  pruneRecord(cache.playbackUrls, MAX_PLAYBACK_URL_ENTRIES, now);
  pruneRecord(cache.lyrics, MAX_LYRIC_ENTRIES, now);

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => librarySave(CACHE_NAMESPACE, cache));
  await writeQueue;
}

export function normalizeQualityKey(quality: string): string {
  const trimmed = quality.trim().toLowerCase();
  if (trimmed === '999') return 'flac24bit';
  if (trimmed === '740') return 'flac';
  if (/^\d+$/.test(trimmed)) return `${trimmed}k`;
  return trimmed;
}

function getTrackKey(music: Pick<MusicInfo, 'source' | 'id'>): string {
  return `${music.source}:${music.id}`;
}

function getPlaybackUrlCacheKey(music: Pick<MusicInfo, 'source' | 'id'>, quality: string): string {
  return `${getTrackKey(music)}:${normalizeQualityKey(quality)}`;
}

function getLyricCacheKey(music: Pick<MusicInfo, 'source' | 'id'>): string {
  return getTrackKey(music);
}

export async function getCachedPlaybackUrl(
  primary: MusicInfo,
  qualityPreference: string[],
  variants: MusicInfo[] = [primary],
  now = Date.now(),
): Promise<PlaybackResolvedUrl | null> {
  const cache = await loadCache();
  const candidates = variants.length ? variants : [primary];

  for (const music of candidates) {
    for (const quality of qualityPreference) {
      const key = getPlaybackUrlCacheKey(music, quality);
      const entry = cache.playbackUrls[key];
      if (!entry) continue;
      if (entry.expiresAt <= now) {
        delete cache.playbackUrls[key];
        void saveCache(cache, now);
        continue;
      }
      return {
        url: entry.url,
        music: entry.music,
        quality: entry.quality,
        backend: entry.backend,
        resolverName: entry.resolverName,
        fromCache: true,
        cacheKey: key,
        trace: [{
          backend: entry.backend,
          resolverName: entry.resolverName,
          source: entry.music.source,
          quality: entry.quality,
          status: 'success',
        }],
      };
    }
  }

  return null;
}

export async function saveCachedPlaybackUrl(
  primary: MusicInfo,
  resolved: PlaybackResolvedUrl,
  now = Date.now(),
): Promise<void> {
  const cache = await loadCache();
  const entry: CachedPlaybackUrlEntry = {
    url: resolved.url,
    music: resolved.music,
    quality: normalizeQualityKey(resolved.quality),
    backend: resolved.backend,
    resolverName: resolved.resolverName,
    cachedAt: now,
    expiresAt: now + (resolved.music.source === 'bili' ? BILI_PLAYBACK_URL_TTL_MS : PLAYBACK_URL_TTL_MS),
  };

  cache.playbackUrls[getPlaybackUrlCacheKey(primary, entry.quality)] = entry;
  cache.playbackUrls[getPlaybackUrlCacheKey(resolved.music, entry.quality)] = entry;
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
    const key = getPlaybackUrlCacheKey(music, quality);
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

export async function getCachedLyrics(
  music: MusicInfo,
  now = Date.now(),
): Promise<LyricResponse | null> {
  const cache = await loadCache();
  const key = getLyricCacheKey(music);
  const entry = cache.lyrics[key];
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    delete cache.lyrics[key];
    void saveCache(cache, now);
    return null;
  }
  return entry.response;
}

export function isCacheableEmptyLyricResult(result: LyricResponse): boolean {
  return result.lines.length === 0 && !!result.error && CACHEABLE_EMPTY_LYRIC_ERRORS.has(result.error);
}

export async function saveCachedLyrics(
  music: MusicInfo,
  response: LyricResponse,
  now = Date.now(),
): Promise<void> {
  if (response.lines.length === 0 && !isCacheableEmptyLyricResult(response)) return;

  const cache = await loadCache();
  const ttl = response.lines.length > 0 ? LYRIC_FOUND_TTL_MS : LYRIC_EMPTY_TTL_MS;
  cache.lyrics[getLyricCacheKey(music)] = {
    response,
    cachedAt: now,
    expiresAt: now + ttl,
  };
  await saveCache(cache, now);
}
