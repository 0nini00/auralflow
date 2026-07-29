export const DEFAULT_VOLUME = 0.8;
export const IMMERSIVE_VOLUME_PRESETS = [0, 0.25, 0.5, 0.8, 1] as const;

export interface PlayerVolumeState {
  volume: number;
  previousVolume: number;
  isMuted: boolean;
}

export interface ImmersiveVolumeOption {
  value: number;
  label: string;
  active: boolean;
}

export interface ImmersiveVolumeControlModel {
  title: string;
  triggerLabel: string;
  meta: string;
  closeLabel: string;
  muteLabel: string;
  muted: boolean;
  options: ImmersiveVolumeOption[];
}

export function formatPlayerVolume(volume: number): string {
  return `${Math.round(clampPlayerVolume(volume) * 100)}%`;
}

export function clampPlayerVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, volume));
}

export function getNextVolumeState(current: PlayerVolumeState, volume: number): PlayerVolumeState {
  const nextVolume = clampPlayerVolume(volume);
  return {
    volume: nextVolume,
    previousVolume: nextVolume > 0 ? nextVolume : current.previousVolume,
    isMuted: nextVolume === 0,
  };
}

export function getNextMuteState(current: PlayerVolumeState): PlayerVolumeState {
  if (!current.isMuted) {
    return {
      volume: 0,
      previousVolume: current.volume > 0 ? current.volume : current.previousVolume,
      isMuted: true,
    };
  }

  const restoredVolume = current.previousVolume > 0 ? clampPlayerVolume(current.previousVolume) : DEFAULT_VOLUME;
  return {
    volume: restoredVolume,
    previousVolume: restoredVolume,
    isMuted: false,
  };
}
export function normalizePersistedVolumeState(value: Partial<PlayerVolumeState> | null | undefined): PlayerVolumeState {
  const previousVolume = clampPlayerVolume(value?.previousVolume ?? value?.volume ?? DEFAULT_VOLUME);
  const restoredPreviousVolume = previousVolume > 0 ? previousVolume : DEFAULT_VOLUME;
  const isMuted = value?.isMuted === true;
  const restoredVolume = isMuted ? 0 : clampPlayerVolume(value?.volume ?? restoredPreviousVolume);

  return {
    volume: restoredVolume,
    previousVolume: restoredPreviousVolume,
    isMuted: isMuted || restoredVolume === 0,
  };
}

export function buildImmersiveVolumeControlModel(volume: number, isMuted: boolean): ImmersiveVolumeControlModel {
  const currentVolume = clampPlayerVolume(volume);
  return {
    title: "音量",
    triggerLabel: isMuted ? "静音 已静音" : `音量 ${formatPlayerVolume(currentVolume)}`,
    meta: isMuted ? "当前已静音" : `当前 ${formatPlayerVolume(currentVolume)}`,
    closeLabel: "关闭",
    muteLabel: isMuted ? "取消静音" : "静音",
    muted: isMuted,
    options: IMMERSIVE_VOLUME_PRESETS.map((preset) => ({
      value: preset,
      label: formatPlayerVolume(preset),
      active: !isMuted && Math.round(currentVolume * 100) === Math.round(preset * 100),
    })),
  };
}
