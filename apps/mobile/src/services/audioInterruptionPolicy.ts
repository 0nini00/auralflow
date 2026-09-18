import { clampPlayerVolume } from "@/services/playerVolumeModel";

export interface AudioInterruptionInput {
  paused: boolean;
  permanent: boolean;
  pauseOnExternalPlayback: boolean;
  currentVolume?: number;
}

export type AudioInterruptionAction =
  | { type: "none" }
  | { type: "pause" }
  | { type: "setVolume"; volume: number };

export function normalizePauseOnExternalPlayback(value: boolean | string | null | undefined): boolean {
  return value !== false;
}

export function getAudioInterruptionAction({
  paused,
  permanent,
  pauseOnExternalPlayback,
}: AudioInterruptionInput): AudioInterruptionAction {
  // 设置为「暂停」：外部应用抢占焦点（永久或临时）时均执行暂停
  if (pauseOnExternalPlayback) {
    if (permanent || paused) {
      return { type: "pause" };
    }
    return { type: "none" };
  }

  // 设置为「不暂停」：其他应用播放音频时不暂停，也不降低音量，忽略打断继续播放
  return { type: "none" };
}
