import type { MusicInfo } from '@lx/core';
import { getLyrics, type LyricResponse } from '@/services/lyricsService';
import { playerEngine } from '@/services/playerEngine';
import { resolvePlaybackUrl } from './playbackResolver';
import {
  buildPlaybackPrefetchEntry,
  type PlaybackPrefetchEntry,
  type PrefetchResolvedUrl,
} from './prefetchModel';

type RepeatMode = 'off' | 'all' | 'one';

export interface PrefetchNearbyTracksOptions {
  queue: MusicInfo[];
  currentIndex: number;
  repeatMode: RepeatMode;
  isShuffle?: boolean;
  fmMode?: boolean;
  resolvePlaybackUrl?: (music: MusicInfo, variants?: MusicInfo[]) => Promise<PrefetchResolvedUrl | null | undefined>;
  getLyrics?: (music: MusicInfo) => Promise<LyricResponse>;
  preloadUrl?: (url: string) => void;
  preloadCoverUrl?: (url: string) => void;
  now?: () => number;
}

const PREFETCH_TTL_MS = 10 * 60 * 1000;
const PREFETCH_OFFSETS = [-1, 1, 2] as const;
const SHUFFLE_PREFETCH_OFFSETS = [1, 2, -1] as const;
const prefetchCache = new Map<string, PlaybackPrefetchEntry>();

function getTrackKey(music: MusicInfo): string {
  return `${music.source}:${music.id}`;
}

function getCoverUrl(music: MusicInfo): string | undefined {
  return music.img || music.picUrl || undefined;
}

function getQueueIndex(queueLength: number, currentIndex: number, offset: number, repeatMode: RepeatMode): number | null {
  if (queueLength <= 0 || currentIndex < 0 || currentIndex >= queueLength) return null;
  const rawIndex = currentIndex + offset;
  if (rawIndex >= 0 && rawIndex < queueLength) return rawIndex;
  if (repeatMode !== 'all') return null;
  return ((rawIndex % queueLength) + queueLength) % queueLength;
}

function getNearbyTracks(
  queue: MusicInfo[],
  currentIndex: number,
  repeatMode: RepeatMode,
  isShuffle: boolean,
): MusicInfo[] {
  const seen = new Set<string>();
  const result: MusicInfo[] = [];
  const offsets = isShuffle ? SHUFFLE_PREFETCH_OFFSETS : PREFETCH_OFFSETS;

  for (const offset of offsets) {
    const index = getQueueIndex(queue.length, currentIndex, offset, repeatMode);
    if (index == null || index === currentIndex) continue;

    const music = queue[index];
    if (!music) continue;

    const key = getTrackKey(music);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(music);
  }

  return result;
}

function isFreshEntry(entry: PlaybackPrefetchEntry | undefined, now: number): boolean {
  return !!entry && now - entry.fetchedAt < PREFETCH_TTL_MS;
}

function getLocalAudioUrl(music: MusicInfo): string | undefined {
  if ('isLocal' in music && music.isLocal && 'url' in music && music.url) {
    return String(music.url);
  }
  return undefined;
}

function getPlaybackVariants(music: MusicInfo): MusicInfo[] | undefined {
  const variants = (music as { variants?: unknown }).variants;
  return Array.isArray(variants) ? (variants as MusicInfo[]) : undefined;
}

function defaultPreloadCover(url: string): void {
  if (typeof Image === 'undefined') return;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
}

async function prefetchTrack(
  music: MusicInfo,
  options: Required<Pick<PrefetchNearbyTracksOptions, 'resolvePlaybackUrl' | 'getLyrics' | 'preloadUrl' | 'preloadCoverUrl' | 'now'>>,
): Promise<void> {
  const fetchedAt = options.now();
  const key = getTrackKey(music);
  if (isFreshEntry(prefetchCache.get(key), fetchedAt)) return;

  let entry: PlaybackPrefetchEntry = {
    ...buildPlaybackPrefetchEntry(music, null, fetchedAt),
    coverUrl: getCoverUrl(music),
  };

  if (entry.coverUrl) options.preloadCoverUrl(entry.coverUrl);

  try {
    const localUrl = getLocalAudioUrl(music);
    if (localUrl) {
      entry = {
        ...entry,
        ...buildPlaybackPrefetchEntry(music, { url: localUrl, quality: 'local', music }, fetchedAt),
        coverUrl: entry.coverUrl,
      };
    } else {
      const variants = getPlaybackVariants(music);
      const resolved = await options.resolvePlaybackUrl(music, variants);
      if (resolved?.url) {
        entry = {
          ...entry,
          ...buildPlaybackPrefetchEntry(music, resolved, fetchedAt),
          coverUrl: entry.coverUrl,
        };
      }
    }
    if (entry.url) options.preloadUrl(entry.url);
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
  }

  try {
    entry.lyrics = await options.getLyrics(music);
  } catch (error) {
    entry.error = entry.error
      ? `${entry.error}\n${error instanceof Error ? error.message : String(error)}`
      : error instanceof Error ? error.message : String(error);
  }

  prefetchCache.set(key, entry);
}

export async function prefetchNearbyTracks({
  queue,
  currentIndex,
  repeatMode,
  isShuffle = false,
  fmMode = false,
  resolvePlaybackUrl: resolveUrl = resolvePlaybackUrl,
  getLyrics: loadLyrics = getLyrics,
  preloadUrl = (url) => playerEngine.preload(url),
  preloadCoverUrl = defaultPreloadCover,
  now = () => Date.now(),
}: PrefetchNearbyTracksOptions): Promise<void> {
  if (fmMode || queue.length === 0) return;

  const dependencies = {
    resolvePlaybackUrl: resolveUrl,
    getLyrics: loadLyrics,
    preloadUrl,
    preloadCoverUrl,
    now,
  };

  // 并行预取所有邻近歌曲，避免单首 URL 解析卡顿拖慢整体
  const tracks = getNearbyTracks(queue, currentIndex, repeatMode, isShuffle);
  await Promise.all(tracks.map((music) => prefetchTrack(music, dependencies)));
}

export function getPrefetchedTrack(music: MusicInfo): PlaybackPrefetchEntry | undefined {
  return prefetchCache.get(getTrackKey(music));
}

export function clearPlaybackPrefetchCache(): void {
  prefetchCache.clear();
}

export function invalidatePrefetchedTrack(music: MusicInfo): void {
  prefetchCache.delete(getTrackKey(music));
}
