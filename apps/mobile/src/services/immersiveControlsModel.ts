export interface ImmersiveControlsVisibilityModel {
  controlsVisible: boolean;
  hidden: boolean;
  actionLabel: string;
  restoreLabel: string;
  nextControlsVisible: boolean;
}

export function buildImmersiveControlsVisibilityModel(controlsVisible: boolean): ImmersiveControlsVisibilityModel {
  return {
    controlsVisible,
    hidden: !controlsVisible,
    actionLabel: controlsVisible ? "隐藏控制栏" : "显示控制栏",
    restoreLabel: "显示控制栏",
    nextControlsVisible: !controlsVisible,
  };
}

export function getPosterWaveSeekTime(
  locationX: number,
  width: number,
  duration: number,
): number | null {
  if (!Number.isFinite(locationX) || !Number.isFinite(width) || !Number.isFinite(duration)) {
    return null;
  }
  if (width <= 0 || duration <= 0) return null;

  const clampedLocation = Math.min(width, Math.max(0, locationX));
  return (clampedLocation / width) * duration;
}
