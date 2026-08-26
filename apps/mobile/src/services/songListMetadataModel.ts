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

export function shouldShowSongListLikeAction(song: Pick<MusicInfo, "source">): boolean {
  return song.source !== "local" && song.source !== "bili";
}

export function shouldShowSongListDownloadAction(song: Pick<MusicInfo, "source">): boolean {
  return song.source !== "local";
}
