import type { MusicInfo } from "@lx/core";
import type { PlaybackBackendId } from "./types";

export interface PrefetchResolvedUrl {
  url: string;
  quality?: string;
  music?: MusicInfo;
  fromCache?: boolean;
  backend?: PlaybackBackendId;
}

export interface PlaybackPrefetchEntry {
  music: MusicInfo;
  url?: string;
  quality?: string;
  fromPersistentCache?: boolean;
  backend?: PlaybackBackendId;
  customSourceVersion?: number;
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
    backend: resolved?.backend,
    fetchedAt,
  };
}

export function selectCachedPlaybackTarget(
  original: MusicInfo,
  cached: Pick<PlaybackPrefetchEntry, "music" | "url" | "quality" | "fromPersistentCache" | "backend" | "customSourceVersion"> | null | undefined,
): (Pick<PlaybackPrefetchEntry, "music" | "quality" | "fromPersistentCache" | "backend" | "customSourceVersion"> & { url: string }) | null {
  if (!cached?.url) return null;
  return {
    music: cached.music ?? original,
    url: cached.url,
    quality: cached.quality,
    fromPersistentCache: cached.fromPersistentCache,
    backend: cached.backend,
    customSourceVersion: cached.customSourceVersion,
  };
}
