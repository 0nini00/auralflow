import type { LocalSong } from "../services/localMusicService";

export interface LibraryScanSuccess {
  path: string;
  ok: true;
  songs: LocalSong[];
}

export interface LibraryScanFailure {
  path: string;
  ok: false;
  error: unknown;
}

export type LibraryScanResult = LibraryScanSuccess | LibraryScanFailure;

export interface MergeLibraryRefreshInput {
  scanPaths: string[];
  localSongs: LocalSong[];
  scanResults: LibraryScanResult[];
}

export interface MergeLibraryRefreshResult {
  songs: LocalSong[];
  added: number;
  removed: number;
  failedPaths: string[];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function isPathInsideBase(path: string, basePath: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedBase = normalizePath(basePath);
  return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`);
}

export function mergeLibraryRefreshResults({
  localSongs,
  scanResults,
}: MergeLibraryRefreshInput): MergeLibraryRefreshResult {
  const successfulResults = scanResults.filter((result): result is LibraryScanSuccess => result.ok);
  const successfulScanPaths = successfulResults.map((result) => result.path);
  const failedPaths = scanResults
    .filter((result): result is LibraryScanFailure => !result.ok)
    .map((result) => result.path);
  const scannedSongs = successfulResults.flatMap((result) => result.songs);
  const scannedPaths = new Set(scannedSongs.map((song) => normalizePath(song.path)));

  const existingSongs = localSongs.filter(
    (song) =>
      !successfulScanPaths.some((scanPath) => isPathInsideBase(song.path, scanPath)) ||
      scannedPaths.has(normalizePath(song.path)),
  );
  const removed = localSongs.length - existingSongs.length;
  const existingIds = new Set(existingSongs.map((song) => song.id));
  const newSongs = scannedSongs.filter((song) => !existingIds.has(song.id));

  return {
    songs: [...existingSongs, ...newSongs],
    added: newSongs.length,
    removed,
    failedPaths,
  };
}
