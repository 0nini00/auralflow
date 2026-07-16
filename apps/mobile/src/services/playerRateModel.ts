export const DEFAULT_PLAYBACK_RATE = 1;
export const SUPPORTED_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface ImmersivePlaybackRateOption {
  value: number;
  label: string;
  active: boolean;
}

export interface ImmersivePlaybackRateModel {
  title: string;
  triggerLabel: string;
  closeLabel: string;
  options: ImmersivePlaybackRateOption[];
}

const MIN_PLAYBACK_RATE = SUPPORTED_PLAYBACK_RATES[0];
const MAX_PLAYBACK_RATE = SUPPORTED_PLAYBACK_RATES[SUPPORTED_PLAYBACK_RATES.length - 1];

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_PLAYBACK_RATE;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate));
}

export function formatPlaybackRate(rate: number): string {
  return `${clampPlaybackRate(rate)}x`;
}

export function buildImmersivePlaybackRateModel(rate: number): ImmersivePlaybackRateModel {
  const current = clampPlaybackRate(rate);
  return {
    title: "播放倍速",
    triggerLabel: `倍速 ${formatPlaybackRate(current)}`,
    closeLabel: "关闭",
    options: SUPPORTED_PLAYBACK_RATES.map((value) => ({
      value,
      label: formatPlaybackRate(value),
      active: value === current,
    })),
  };
}
