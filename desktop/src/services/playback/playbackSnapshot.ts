import type { MusicInfo } from "@lx/core";
import { usePlayerStore } from "@/stores/playerStore";
import type { RepeatMode } from "@/stores/playerStore";

export type PlaybackSnapshotStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface PlaybackSnapshotTrack {
  id: string;
  source: string;
  name: string;
  singer: string;
  albumName?: string;
  coverUrl?: string;
}

export interface PlaybackSnapshotSource {
  current: MusicInfo | null;
  queue: MusicInfo[];
  currentIndex: number;
  status: PlaybackSnapshotStatus;
  progress: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  fmMode: boolean;
  error: string | null;
}

export interface PlaybackSnapshot {
  current: MusicInfo | null;
  track: PlaybackSnapshotTrack | null;
  hasTrack: boolean;
  status: PlaybackSnapshotStatus;
  isPlaying: boolean;
  progress: number;
  duration: number;
  progressRatio: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  fmMode: boolean;
  queueIndex: number;
  queueLength: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  error: string | null;
  updatedAt: number;
}

export type PlaybackSnapshotStorePatch = Pick<
  PlaybackSnapshotSource,
  | "current"
  | "status"
  | "progress"
  | "duration"
  | "volume"
  | "isMuted"
  | "playbackRate"
  | "repeatMode"
  | "isShuffle"
  | "fmMode"
  | "error"
>;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function getCoverUrl(music: MusicInfo): string | undefined {
  return music.img || music.picUrl || undefined;
}

function buildTrack(music: MusicInfo | null): PlaybackSnapshotTrack | null {
  if (!music) return null;
  return {
    id: String(music.id),
    source: String(music.source),
    name: music.name ?? "",
    singer: music.singer ?? "",
    albumName: music.albumName || undefined,
    coverUrl: getCoverUrl(music),
  };
}

function resolveQueueIndex(source: PlaybackSnapshotSource): number {
  if (source.currentIndex >= 0 && source.currentIndex < source.queue.length) {
    return source.currentIndex;
  }
  if (!source.current) return -1;
  return source.queue.findIndex((item) => item.id === source.current?.id && item.source === source.current?.source);
}

function hasQueueNeighbors(queueLength: number): boolean {
  return queueLength > 1;
}

export function buildPlaybackSnapshot(source: PlaybackSnapshotSource, updatedAt = Date.now()): PlaybackSnapshot {
  const track = buildTrack(source.current);
  const progress = finiteOrZero(source.progress);
  const duration = finiteOrZero(source.duration);
  const queueLength = source.queue.length;
  const queueIndex = resolveQueueIndex(source);
  const hasTrack = Boolean(source.current);
  const hasNeighbors = hasQueueNeighbors(queueLength);
  const canGoPrevious = hasTrack && !source.fmMode && (
    queueIndex > 0 || (source.repeatMode === "all" && hasNeighbors)
  );
  const canGoNext = hasTrack && (
    source.fmMode ||
    (queueIndex >= 0 && queueIndex < queueLength - 1) ||
    (source.repeatMode === "all" && hasNeighbors)
  );

  return {
    current: source.current,
    track,
    hasTrack,
    status: source.status,
    isPlaying: source.status === "playing",
    progress,
    duration,
    progressRatio: duration > 0 ? clamp01(progress / duration) : 0,
    volume: clamp01(source.volume),
    isMuted: source.isMuted,
    playbackRate: Number.isFinite(source.playbackRate) && source.playbackRate > 0 ? source.playbackRate : 1,
    repeatMode: source.repeatMode,
    isShuffle: source.isShuffle,
    fmMode: source.fmMode,
    queueIndex,
    queueLength,
    canGoPrevious,
    canGoNext,
    error: source.error,
    updatedAt,
  };
}

export function getPlaybackSnapshotFromStore(updatedAt = Date.now()): PlaybackSnapshot {
  return buildPlaybackSnapshot(usePlayerStore.getState(), updatedAt);
}

export function applyPlaybackSnapshotToStorePatch(snapshot: PlaybackSnapshot): PlaybackSnapshotStorePatch {
  return {
    current: snapshot.current,
    status: snapshot.status,
    progress: snapshot.progress,
    duration: snapshot.duration,
    volume: snapshot.volume,
    isMuted: snapshot.isMuted,
    playbackRate: snapshot.playbackRate,
    repeatMode: snapshot.repeatMode,
    isShuffle: snapshot.isShuffle,
    fmMode: snapshot.fmMode,
    error: snapshot.error,
  };
}
