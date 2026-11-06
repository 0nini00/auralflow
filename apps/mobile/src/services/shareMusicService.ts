import { Alert, Clipboard } from "react-native";
import { buildMusicShareLink, buildMusicShareText, type MusicInfo } from "@lx/core";
export { buildMusicShareLink, buildMusicShareText } from "@lx/core";

export interface MobileSharePayload {
  title: string;
  message: string;
  url?: string;
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

  // 有可用链接（wy/tx 等）时走系统分享面板，失败也要提示用户。
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
