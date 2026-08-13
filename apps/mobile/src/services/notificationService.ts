import TrackPlayer from "react-native-track-player";
import type { MusicInfo } from "@lx/core";

/**
 * 更新通知栏元数据
 */
export async function updateNotificationMetadata(song: MusicInfo): Promise<void> {
  try {
    const currentTrack = await TrackPlayer.getActiveTrack();
    if (!currentTrack) return;

    // 更新当前 track 的元数据
    await TrackPlayer.updateMetadataForTrack(0, {
      title: song.name,
      artist: song.singer || "未知艺术家",
      album: song.albumName || "未知专辑",
      artwork: song.picUrl || song.img || undefined,
    });
  } catch {}
}

/**
 * 清除通知栏
 */
export async function clearNotification(): Promise<void> {
  try {
    await TrackPlayer.reset();
  } catch {}
}
