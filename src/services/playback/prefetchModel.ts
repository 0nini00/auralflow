import type { MusicInfo } from "@lx/core";

export interface PrefetchResolvedUrl {
  url: string;
  quality?: string;
  music?: MusicInfo;
  fromCache?: boolean;
}

export interface PlaybackPrefetchEntry {
  music: MusicInfo;
  url?: string;
  quality?: string;
  fromPersistentCache?: boolean;
  lyrics?: unknown;
  coverUrl?: string;
  fetchedAt: number;
  error?: string;
}

export function buildPlaybackPrefetchEntry(
  original: MusicInfo,
  resolved: PrefetchResolvedUrl | null | undefined,
  fetchedAt: number,
): PlaybackPrefetchEntry {
  return {
    music: resolved?.music ?? original,
    url: resolved?.url,
    quality: resolved?.quality,
    fromPersistentCache: resolved?.fromCache,
    fetchedAt,
  };
}

export function selectCachedPlaybackTarget(
  original: MusicInfo,
  cached: Pick<PlaybackPrefetchEntry, "music" | "url" | "quality" | "fromPersistentCache"> | null | undefined,
): { music: MusicInfo; url: string; quality?: string; fromPersistentCache?: boolean } | null {
  if (!cached?.url) return null;
  return {
    music: cached.music ?? original,
    url: cached.url,
    quality: cached.quality,
    fromPersistentCache: cached.fromPersistentCache,
  };
}
