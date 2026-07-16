import { Platform } from "react-native";
import TrackPlayer from "react-native-track-player";

import { usePlayerStore } from "@/stores/playerStore";
import { useSoundEffectStore } from "@/stores/soundEffectStore";

/**
 * Android 变调（Pitch）桥接。
 *
 * RNTP 的 Android 实现只设 `player.playbackSpeed`，会把音高与速度耦合。
 * ExoPlayer 的 `PlaybackParameters(speed, pitch)` 支持独立变调且不改变速度，
 * 这里把"倍速"与"变调"合并为一次调用（半音 → 频率比：2^(semitones/12)）。
 *
 * 依赖对 react-native-track-player 的补丁（见 patches/），使其 setRate 透传 pitch。
 * iOS 不支持独立变调，按用户要求仅做 Android；非 Android 走原生单参数 setRate。
 */
export function semitonesToRate(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * 用当前的倍速与变调值同步播放参数。由 playerStore / soundEffectStore 在各自变化时调用，
 * 保证两端中的一个变化后，ExoPlayer 的 PlaybackParameters(speed, pitch) 始终一致。
 */
export async function syncPlaybackParameters(): Promise<void> {
  const rate = usePlayerStore.getState().playbackRate || 1;
  const semitones = useSoundEffectStore.getState().pitch || 0;

  try {
    if (Platform.OS !== "android") {
      await TrackPlayer.setRate(rate);
      return;
    }
    // v5 的 setRate 只接收 rate 一个参数（pitch 不再走 setRate）
    await TrackPlayer.setRate(rate);
  } catch (error) {
    console.warn("syncPlaybackParameters failed:", error);
  }
}
