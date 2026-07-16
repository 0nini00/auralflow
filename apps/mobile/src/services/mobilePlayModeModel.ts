export type MobilePlayMode = "list" | "single" | "shuffle" | "sequence";
export type MobileTrackPlayerRepeatMode = "queue" | "track" | "off";

export const MOBILE_PLAY_MODE_SEQUENCE: readonly MobilePlayMode[] = [
  "list",
  "single",
  "shuffle",
  "sequence",
];

const PLAY_MODE_LABELS: Record<MobilePlayMode, string> = {
  list: "列表循环",
  single: "单曲循环",
  shuffle: "随机播放",
  sequence: "顺序播放",
};

const PLAY_MODE_ICON_LABELS: Record<MobilePlayMode, string> = {
  list: "循环",
  single: "单曲",
  shuffle: "随机",
  sequence: "顺序",
};

const TRACK_PLAYER_REPEAT_MODES: Record<MobilePlayMode, MobileTrackPlayerRepeatMode> = {
  list: "queue",
  single: "track",
  shuffle: "queue",
  sequence: "off",
};

export function getNextMobilePlayMode(mode: MobilePlayMode): MobilePlayMode {
  const currentIndex = MOBILE_PLAY_MODE_SEQUENCE.indexOf(mode);
  if (currentIndex < 0) return MOBILE_PLAY_MODE_SEQUENCE[0];
  return MOBILE_PLAY_MODE_SEQUENCE[(currentIndex + 1) % MOBILE_PLAY_MODE_SEQUENCE.length];
}

export function getMobilePlayModeLabel(mode: MobilePlayMode): string {
  return PLAY_MODE_LABELS[mode];
}

export function getTrackPlayerRepeatModeForPlayMode(mode: MobilePlayMode): MobileTrackPlayerRepeatMode {
  return TRACK_PLAYER_REPEAT_MODES[mode];
}

export interface ImmersivePlayModeControl {
  label: string;
  iconLabel: string;
  active: boolean;
}

export function buildImmersivePlayModeControl(mode: MobilePlayMode): ImmersivePlayModeControl {
  return {
    label: getMobilePlayModeLabel(mode),
    iconLabel: PLAY_MODE_ICON_LABELS[mode],
    active: mode !== "sequence",
  };
}
