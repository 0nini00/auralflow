import { clampPlayerVolume } from "@/services/playerVolumeModel";

export interface AudioInterruptionInput {
  paused: boolean;
  permanent: boolean;
  pauseOnExternalPlayback: boolean;
  currentVolume: number;
}

export type AudioInterruptionAction =
  | { type: "none" }
  | { type: "pause" }
  | { type: "setVolume"; volume: number };

const DUCKED_VOLUME = 0.2;

export function normalizePauseOnExternalPlayback(value: unknown): boolean {
  return value !== false;
}

export function getAudioInterruptionAction({
  paused,
  permanent,
  pauseOnExternalPlayback,
  currentVolume,
}: AudioInterruptionInput): AudioInterruptionAction {
  if (permanent) return { type: "pause" };
  if (paused && pauseOnExternalPlayback) return { type: "pause" };
  if (paused) return { type: "setVolume", volume: Math.min(DUCKED_VOLUME, clampPlayerVolume(currentVolume)) };
  return { type: "setVolume", volume: clampPlayerVolume(currentVolume) };
}
