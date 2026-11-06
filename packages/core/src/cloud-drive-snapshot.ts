import type { MusicInfo } from './sources/types';

export interface CloudDriveSnapshot {
  songs: MusicInfo[];
  count: number;
  usedBytes?: number;
  maxBytes?: number;
  nextOffset: number;
  hasMore: boolean;
  cachedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMusicInfo(value: unknown): value is MusicInfo {
  return isRecord(value)
    && typeof value.source === 'string' && value.source.trim().length > 0
    && typeof value.id === 'string' && value.id.trim().length > 0
    && typeof value.name === 'string' && value.name.trim().length > 0;
}

export function normalizeCloudDriveSongs(value: unknown): MusicInfo[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((item): item is MusicInfo => {
    if (!isMusicInfo(item)) return false;
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeCloudDriveSnapshot(value: unknown): CloudDriveSnapshot | null {
  if (!isRecord(value)) return null;
  const songs = normalizeCloudDriveSongs(value.songs);
  const cachedAt = finiteNumber(value.cachedAt);
  if (songs.length === 0 || cachedAt === undefined) return null;
  return {
    songs,
    count: finiteNumber(value.count) ?? songs.length,
    usedBytes: finiteNumber(value.usedBytes),
    maxBytes: finiteNumber(value.maxBytes),
    nextOffset: finiteNumber(value.nextOffset) ?? songs.length,
    hasMore: value.hasMore === true,
    cachedAt,
  };
}
