import { Platform } from "react-native";
import TrackPlayer from "react-native-track-player";

import { usePlayerStore } from "@/stores/playerStore";

/**
 * Android 倍速同步。
 *
 * RNTP 4.1.2 的原生 `setRate` 只接收单参数（ExoPlayer `player.playbackSpeed`），
 * **不支持独立变调（pitch）**——v4 系列的 `PlaybackParameters(speed, pitch)` 链路
 * 在 4.1.2 中已被移除以简化播放器。因此：
 * - 倍速通过 `setRate(rate)` 生效（ExoPlayer 变调与变速耦合，速度改变时音高随之改变）。
 * - 独立变调在移动端无实现：原生 AudioFx 的 setPitch 返回 false，UI 不提供该控件。
 *
 * 本函数由 playerStore 在播放参数变化时调用，保证倍速始终同步到原生播放器。
 */
export async function syncPlaybackParameters(): Promise<void> {
  const rate = usePlayerStore.getState().playbackRate || 1;

  try {
    await TrackPlayer.setRate(rate);
  } catch {}
}
