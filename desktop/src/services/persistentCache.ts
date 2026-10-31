import type { LyricResponse, MusicInfo } from '@lx/core';
import { libraryLoad, librarySave } from '@lx/tauri-bridge';
import { customSourceAccess, customSourcePersistence, useCustomSourceStore } from '@/stores/customSourceStore';
import type { CustomSourceOperation } from '@/services/customSourceAccess';
import type { PlaybackBackendId, PlaybackResolvedUrl } from '@/services/playback/types';

const CACHE_NAMESPACE = 'cache';

export const PLAYBACK_URL_TTL_MS = 6 * 60 * 60 * 1000;
export const LOCAL_PLAYBACK_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const LYRIC_FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LYRIC_EMPTY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// v2：歌词解析器修复网易云 eapi 富文本元信息行（作词/作曲/编曲…整批丢失）后，
// 旧版缓存里存的解析结果永久缺失这些行且要活 30 天，必须整体失效重拉。
// 播放 URL 缓存一并重置，代价只是首次播放时重新解析一次直链。
export const CACHE_VERSION = 2;
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

async function saveCache(
  cache: PersistentCacheState,
  now = Date.now(),
  commit?: () => void,
): Promise<void> {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => {
      // 排队期间开关可能变化，校验与内存写入必须在同一提交点执行。
      commit?.();
      pruneRecord(cache.playbackUrls, MAX_PLAYBACK_URL_ENTRIES, now);
      pruneRecord(cache.lyrics, MAX_LYRIC_ENTRIES, now);
      return librarySave(CACHE_NAMESPACE, cache);
    });
  await writeQueue;
}

/** 歌曲元信息缓存的条目数：与音频/封面文件分开统计，供设置页分开清理。 */
export interface PersistentCacheSummary {
  /** 已缓存播放地址的歌曲数：同一首歌的多个音质档只计一次，过期条目不计。 */
  playbackUrlCount: number;
  /** 已缓存歌词的歌曲数，过期条目不计。 */
  lyricCount: number;
}

export async function getPersistentCacheSummary(now = Date.now()): Promise<PersistentCacheSummary> {
  const cache = await loadCache();
  const tracks = new Set<string>();
  for (const entry of Object.values(cache.playbackUrls)) {
    if (!entry?.music) continue;
    // 本地文件地址不受 TTL 约束（见 isLocalCachedPlaybackUrl），远端地址过期即不计。
    if (!isLocalCachedPlaybackUrl(entry.url) && entry.expiresAt <= now) continue;
    tracks.add(getTrackKey(entry.music));
  }

  let lyricCount = 0;
  for (const entry of Object.values(cache.lyrics)) {
    if (entry && entry.expiresAt > now) lyricCount += 1;
  }
  return { playbackUrlCount: tracks.size, lyricCount };
}

/** 只清播放地址，保留歌词与音频/封面文件。 */
export async function clearCachedPlaybackUrls(): Promise<void> {
  const cache = await loadCache();
  cache.playbackUrls = {};
  await saveCache(cache);
}

/**
 * 资源缓存（音频/封面文件）被清空后，清理持久化条目里指向这些本地文件的引用。
 *
 * 不清会让条目变成死链：URL 条目存的就是本地 asset 地址，文件删掉后
 * `getCachedPlaybackUrl` 仍会命中它，下一次播放白等一次 `StalePlaybackCacheError`
 * 才重新解析；条目里的封面字段同理，播放条会拿到一个已删除的图片地址。
 * 只动本地引用：仍然指向远端 CDN 的地址不受影响，元信息缓存不必整体作废。
 */
export async function invalidateCachedLocalMedia(): Promise<void> {
  const cache = await loadCache();
  let changed = false;

  for (const [key, entry] of Object.entries(cache.playbackUrls)) {
    if (!entry?.music) {
      delete cache.playbackUrls[key];
      changed = true;
      continue;
    }
    if (isLocalCachedPlaybackUrl(entry.url)) {
      delete cache.playbackUrls[key];
      changed = true;
      continue;
    }
    const picUrl = entry.music.picUrl;
    const img = entry.music.img;
    const localPic = typeof picUrl === 'string' && isLocalCachedPlaybackUrl(picUrl);
    const localImg = typeof img === 'string' && isLocalCachedPlaybackUrl(img);
    if (!localPic && !localImg) continue;
    entry.music = {
      ...entry.music,
      ...(localPic ? { picUrl: undefined } : {}),
      ...(localImg ? { img: undefined } : {}),
    };
    changed = true;
  }

  if (changed) await saveCache(cache);
}

/** 只清歌词缓存，保留播放 URL；音频/封面文件不在这里，由媒体缓存单独清理。 */
export async function clearCachedLyrics(): Promise<void> {
  const cache = await loadCache();
  cache.lyrics = {};
  await saveCache(cache);
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

export function isLocalCachedPlaybackUrl(url: string): boolean {
  return (
    url.startsWith('asset:') ||
    url.includes('__TAURI_ASSET__') ||
    url.startsWith('http://asset.localhost') ||
    url.startsWith('https://asset.localhost')
  );
}

export async function getCachedPlaybackUrl(
  primary: MusicInfo,
  qualityPreference: string[],
  variants: MusicInfo[] = [primary],
  now = Date.now(),
): Promise<PlaybackResolvedUrl | null> {
  if (!useCustomSourceStore.getState().featureReady) await customSourcePersistence.ready;
  const accessVersion = customSourceAccess.version;
  const cache = await loadCache();
  const candidates = variants.length ? variants : [primary];

  for (const music of candidates) {
    for (const quality of qualityPreference) {
      const key = getPlaybackUrlCacheKey(music, quality);
      const entry = cache.playbackUrls[key];
      if (!entry) continue;
      // 隐藏兜底同样经 LX 脚本取链：脚本被停用或版本变化后不再复用其缓存地址。
      if ((entry.backend === 'customSource' || entry.backend === 'hiddenSource') && (
        !useCustomSourceStore.getState().featureEnabled || customSourceAccess.version !== accessVersion
      )) continue;
      if (!isLocalCachedPlaybackUrl(entry.url) && entry.expiresAt <= now) {
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
        cachedAt: entry.cachedAt,
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
  operation?: CustomSourceOperation,
): Promise<void> {
  if ((resolved.backend === 'customSource' || resolved.backend === 'hiddenSource') && !operation) {
    throw new Error('LX 播放地址缓存缺少操作令牌');
  }
  const access = resolved.backend === 'customSource' || resolved.backend === 'hiddenSource' ? operation : undefined;
  access?.assertActive();
  const cache = await loadCache();
  access?.assertActive();
  const entry: CachedPlaybackUrlEntry = {
    url: resolved.url,
    music: resolved.music,
    quality: normalizeQualityKey(resolved.quality),
    backend: resolved.backend,
    resolverName: resolved.resolverName,
    cachedAt: now,
    expiresAt: now + (
      isLocalCachedPlaybackUrl(resolved.url)
        ? LOCAL_PLAYBACK_CACHE_TTL_MS
        : PLAYBACK_URL_TTL_MS
    ),
  };

  await saveCache(cache, now, () => {
    access?.assertActive();
    cache.playbackUrls[getPlaybackUrlCacheKey(primary, entry.quality)] = entry;
    cache.playbackUrls[getPlaybackUrlCacheKey(resolved.music, entry.quality)] = entry;
  });
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
