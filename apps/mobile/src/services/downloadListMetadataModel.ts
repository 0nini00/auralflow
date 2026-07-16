import type { MusicInfo } from "@lx/core";

import type { DownloadedItem, DownloadProgressInfo, DownloadQuality } from "@/services/downloadService";
import { formatDownloadSize } from "@/services/downloadSizeFormatter";

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
  const quality = item.quality ?? item.song.quality ?? "320k";
  const sizeLabel = item.fileSize && item.fileSize > 0 ? formatDownloadSize(item.fileSize) : "未知大小";

  return {
    titleMeta: `${getArtistName(item.song)} · ${quality}`,
    statusLabel: "已下载",
    detailLabel: `${getDownloadFileName(item.localPath)} · ${sizeLabel}`,
  };
}

export function buildDownloadingMetadata(input: DownloadingMetadataInput): DownloadRowMetadata {
  const percent = normalizeProgress(input.progress);
  const detailLabel = input.contentLength > 0
    ? `${formatDownloadSize(input.bytesWritten)} / ${formatDownloadSize(input.contentLength)}`
    : input.bytesWritten > 0
      ? formatDownloadSize(input.bytesWritten)
      : "等待接收数据";

  return {
    titleMeta: `${getArtistName(input.song)} · ${input.quality}`,
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
    titleMeta: `${getArtistName(song)} · ${quality}`,
    statusLabel: "下载失败",
    detailLabel: error || "下载失败",
  };
}
