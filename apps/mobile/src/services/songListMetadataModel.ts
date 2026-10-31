import type { MusicInfo } from "@lx/core";

export interface SongListMetadata {
  artistName: string;
  albumName: string;
  durationLabel: string;
  metaParts: string[];
}

function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function buildSongListMetadata(song: MusicInfo): SongListMetadata {
  const artistName = song.singer?.trim() || "未知歌手";
  const albumName = song.albumName?.trim() || "";
  const durationLabel = formatDuration(song.interval);

  return {
    artistName,
    albumName,
    durationLabel,
    metaParts: [artistName, albumName].filter(Boolean),
  };
}

export function shouldShowSongListDownloadAction(song: Pick<MusicInfo, "source">): boolean {
  return song.source !== "local";
}

/**
 * 下载前是否需要询问音质。
 *
 * 云盘曲不做转码：请求 128k 与 flac 拿到的是同一份上传文件，弹窗里的档位
 * 既不改变结果、也不是文件真实码率，只会让用户以为「选了什么就下什么」。
 * 这类曲目直接下载原文件（保留内嵌标签与歌词）。
 */
export function shouldPromptDownloadQuality(song: Pick<MusicInfo, "wyCloud">): boolean {
  return song.wyCloud !== true;
}
