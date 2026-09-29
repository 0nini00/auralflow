import type { MusicInfo } from "@lx/core";

export function buildMusicShareLink(music: MusicInfo): string | null {
  if (!music.id) return null;

  if (music.source === "wy") {
    return `https://music.163.com/#/song?id=${encodeURIComponent(music.id)}`;
  }

  if (music.source === "tx") {
    return `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(music.id)}`;
  }

  return null;
}

export function buildMusicShareText(music: MusicInfo): string {
  return buildMusicShareLink(music) ?? `${music.name} - ${music.singer}`;
}
