import TrackPlayer, { State } from "react-native-track-player";
import {
  isLyricOverlaySupported,
  pauseLyricOverlayClock,
  playLyricOverlayClock,
} from "@/services/lyricOverlayService";

let clockSyncRevision = 0;

/**
 * 所有时钟写入共用此入口：UI 的 isPlaying 包含缓冲态，不能作为走时依据。
 * 暂停事件立即冻结并作废在途校准；歌词注入和前台校准必须回读原生状态、位置，
 * 不能使用异步回调捕获的旧 React 快照重新启动时钟。
 */
export async function syncLyricOverlayPlaybackClock(state?: State): Promise<void> {
  const revision = ++clockSyncRevision;
  if (!isLyricOverlaySupported()) return;

  if (state !== undefined && state !== State.Playing) {
    await pauseLyricOverlayClock();
    return;
  }

  const { position } = await TrackPlayer.getProgress();
  if (revision !== clockSyncRevision) return;
  const playback = await TrackPlayer.getPlaybackState();
  if (revision !== clockSyncRevision) return;

  if (playback.state !== State.Playing) {
    await pauseLyricOverlayClock();
    return;
  }
  await playLyricOverlayClock(position);
}
