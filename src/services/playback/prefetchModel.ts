import type { MusicInfo } from "@lx/core";

export interface PrefetchResolvedUrl {
  url: string;
  quality?: string;
  music?: MusicInfo;
}

export interface PlaybackPrefetchEntry {
  music: MusicInfo;
  url?: string;
  quality?: string;
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
    fetchedAt,
  };
}

export function selectCachedPlaybackTarget(
  original: MusicInfo,
  cached: Pick<PlaybackPrefetchEntry, "music" | "url"> | null | undefined,
): { music: MusicInfo; url: string } | null {
  if (!cached?.url) return null;
  return {
    music: cached.music ?? original,
    url: cached.url,
  };
}
