import type { MusicInfo } from "@lx/core";

export interface MobileSharePayload {
  title: string;
  message: string;
  url?: string;
}

export function buildMusicShareLink(music: MusicInfo): string | null {
  if (!music.id) return null;

  if (music.source === "wy") {
    return `https://music.163.com/#/song?id=${encodeURIComponent(music.id)}`;
  }

  if (music.source === "tx") {
    return `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(music.id)}`;
  }

  if (music.source === "bili") {
    return `https://www.bilibili.com/video/${encodeURIComponent(music.id)}`;
  }

  return null;
}

export function buildMusicShareText(music: MusicInfo): string {
  return buildMusicShareLink(music) ?? `${music.name} - ${music.singer}`;
}

export function buildMusicSharePayload(music: MusicInfo): MobileSharePayload {
  const text = buildMusicShareText(music);
  const link = buildMusicShareLink(music);
  return {
    title: "分享歌曲",
    message: text,
    ...(link ? { url: link } : {}),
  };
}

export async function shareMusic(music: MusicInfo): Promise<void> {
  const { Share } = await import("react-native");
  await Share.share(buildMusicSharePayload(music));
}
