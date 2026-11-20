import type { MusicInfo } from "@lx/core";
import type { PlaybackBackendId, PlaybackResolvedUrl } from "./types";

export interface PrefetchResolvedUrl {
  url: string;
  quality?: string;
  music?: MusicInfo;
  fromCache?: boolean;
  backend?: PlaybackBackendId;
  candidateId?: string;
  fallbacks?: PlaybackResolvedUrl[];
}

export interface PlaybackPrefetchEntry {
  music: MusicInfo;
  url?: string;
  quality?: string;
  fromPersistentCache?: boolean;
  backend?: PlaybackBackendId;
  candidateId?: string;
  fallbacks?: PlaybackResolvedUrl[];
  customSourceVersion?: number;
  selectionKey?: string;
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
    candidateId: resolved?.candidateId,
    fallbacks: resolved?.fallbacks,
    fetchedAt,
  };
}

export function selectCachedPlaybackTarget(
  original: MusicInfo,
  cached: Pick<PlaybackPrefetchEntry, "music" | "url" | "quality" | "fromPersistentCache" | "backend" | "customSourceVersion" | "candidateId" | "fallbacks"> | null | undefined,
): (Pick<PlaybackPrefetchEntry, "music" | "quality" | "fromPersistentCache" | "backend" | "customSourceVersion" | "candidateId" | "fallbacks"> & { url: string }) | null {
  if (!cached?.url) return null;
  return {
    music: cached.music ?? original,
    url: cached.url,
    quality: cached.quality,
    fromPersistentCache: cached.fromPersistentCache,
    backend: cached.backend,
    customSourceVersion: cached.customSourceVersion,
    candidateId: cached.candidateId,
    fallbacks: cached.fallbacks,
  };
}
