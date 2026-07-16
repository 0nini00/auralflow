import type { MusicInfo } from "@lx/core";
import type {
  DownloadedItem,
  DownloadQuality,
} from "@/services/downloadService";

export type DownloadStatus =
  | "idle"
  | "downloading"
  | "completed"
  | "failed";

interface DownloadingRecord {
  song: MusicInfo;
  quality: DownloadQuality;
  progress: number;
}

interface FailedDownloadRecord {
  song: MusicInfo;
  quality: DownloadQuality;
}

interface DownloadRecordState {
  downloads: DownloadedItem[];
  downloading: DownloadingRecord[];
  failedDownloads: FailedDownloadRecord[];
}

function songKey(song: MusicInfo): string {
  return `${song.source}:${song.id}`;
}

function requestedQuality(song: MusicInfo): DownloadQuality | null {
  const value = song.quality;
  return value === "128k" ||
    value === "192k" ||
    value === "320k" ||
    value === "flac" ||
    value === "flac24bit"
    ? value
    : null;
}

function matches(
  song: MusicInfo,
  quality: DownloadQuality | undefined,
  target: MusicInfo,
): boolean {
  if (songKey(song) !== songKey(target)) return false;
  const requested = requestedQuality(target);
  return requested === null || (quality ?? song.quality ?? "320k") === requested;
}

export function selectDownloadStatus(
  state: DownloadRecordState,
  song: MusicInfo,
): DownloadStatus {
  if (state.downloads.some((item) => matches(item.song, item.quality, song))) {
    return "completed";
  }
  if (
    state.downloading.some((item) =>
      matches(item.song, item.quality, song),
    )
  ) {
    return "downloading";
  }
  if (
    state.failedDownloads.some((item) =>
      matches(item.song, item.quality, song),
    )
  ) {
    return "failed";
  }
  return "idle";
}

export function selectDownloadProgress(
  state: DownloadRecordState,
  song: MusicInfo,
): number {
  if (state.downloads.some((item) => matches(item.song, item.quality, song))) {
    return 1;
  }
  return (
    state.downloading.find((item) =>
      matches(item.song, item.quality, song),
    )?.progress ?? 0
  );
}
