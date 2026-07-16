import type { MusicInfo, SourceTag } from "@lx/core";

export function getSourceLabel(source: SourceTag): string {
  if (source === "wy") return "网易云";
  if (source === "tx") return "QQ音乐";
  if (source === "bili") return "B站";
  return "本地";
}

export function formatArtists(song: MusicInfo): string {
  return song.singer || "未知歌手";
}

export function getArtworkUrl(song: MusicInfo): string | undefined {
  return song.picUrl || song.img || undefined;
}
