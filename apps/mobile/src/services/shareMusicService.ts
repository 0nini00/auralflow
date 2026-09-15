import { Alert, Clipboard } from "react-native";
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
  const payload = buildMusicSharePayload(music);

  // 有可用链接（wy/tx/bili 等）时走系统分享面板，失败也要提示用户。
  if (payload.url) {
    try {
      await Share.share(payload);
    } catch (err) {
      Alert.alert("分享失败", err instanceof Error ? err.message : String(err));
    }
    return;
  }

  // 本地/不支持的来源没有可用链接，改为复制分享文案到剪贴板。
  try {
    Clipboard.setString(payload.message);
    Alert.alert("已复制分享文案", payload.message);
  } catch (err) {
    // 剪贴板不可用时退化为分享纯文本，失败仍会提示。
    try {
      await Share.share({ message: payload.message, title: payload.title });
    } catch (shareErr) {
      Alert.alert(
        "分享失败",
        shareErr instanceof Error ? shareErr.message : String(shareErr),
      );
    }
  }
}
