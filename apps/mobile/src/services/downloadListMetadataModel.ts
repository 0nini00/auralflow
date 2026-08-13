import type { MusicInfo } from "@lx/core";

import type { DownloadedItem, DownloadProgressInfo, DownloadQuality } from "@/services/downloadService";
import { formatDownloadSize } from "@/services/downloadSizeFormatter";
import { getPlaybackQualityLabel } from "@/services/playbackQualityModel";

export interface DownloadRowMetadata {
  titleMeta: string;
  statusLabel: string;
  detailLabel: string;
}

interface DownloadingMetadataInput extends DownloadProgressInfo {
  song: MusicInfo;
  quality: DownloadQuality | string;
}

function getArtistName(song: MusicInfo): string {
  return song.singer?.trim() || "未知艺术家";
}

function normalizeProgress(progress: number): number {
  return Math.round(Math.max(0, Math.min(1, progress)) * 100);
}

export function getDownloadFileName(localPath: string): string {
  const path = localPath.startsWith("file://") ? localPath.slice("file://".length) : localPath;
  return decodeURIComponent(path.split(/[\\/]/).filter(Boolean).pop() || "未知文件");
}

export function buildCompletedDownloadMetadata(item: DownloadedItem): DownloadRowMetadata {
  const quality = getPlaybackQualityLabel(item.quality ?? item.song.quality ?? "320k");
  const sizeLabel = item.fileSize && item.fileSize > 0 ? formatDownloadSize(item.fileSize) : "未知大小";

  return {
    titleMeta: `${getArtistName(item.song)} · ${quality}`,
    statusLabel: "已下载",
    detailLabel: `${getDownloadFileName(item.localPath)} · ${sizeLabel}`,
  };
}

/** 格式化下载速度（字节/秒 → 人类可读）。 */
export function formatDownloadSpeed(speed: number): string {
  if (!Number.isFinite(speed) || speed <= 0) return "";
  const kb = speed / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB/s`;
  return `${(kb / 1024).toFixed(1)} MB/s`;
}

export function buildDownloadingMetadata(input: DownloadingMetadataInput): DownloadRowMetadata {
  const percent = normalizeProgress(input.progress);
  const detailLabel = input.contentLength > 0
    ? `${formatDownloadSize(input.bytesWritten)} / ${formatDownloadSize(input.contentLength)}`
    : input.bytesWritten > 0
      ? formatDownloadSize(input.bytesWritten)
      : "等待接收数据";

  return {
    titleMeta: `${getArtistName(input.song)} · ${getPlaybackQualityLabel(input.quality)}`,
    statusLabel: `下载中 ${percent}%`,
    detailLabel,
  };
}

export function buildFailedDownloadMetadata({
  song,
  quality,
  error,
}: {
  song: MusicInfo;
  quality: DownloadQuality | string;
  error: string;
}): DownloadRowMetadata {
  return {
    titleMeta: `${getArtistName(song)} · ${getPlaybackQualityLabel(quality)}`,
    statusLabel: "下载失败",
    detailLabel: error || "下载失败",
  };
}
