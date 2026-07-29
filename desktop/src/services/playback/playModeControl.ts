export type PlayModeId = "list-loop" | "single-loop" | "shuffle" | "sequence";
export type PlayModeRepeatMode = "off" | "all" | "one";

export interface PlayModeState {
  repeatMode: PlayModeRepeatMode;
  isShuffle: boolean;
}

export interface PlayModeControl {
  id: PlayModeId;
  label: string;
}

export const PLAY_MODE_SEQUENCE: readonly PlayModeId[] = [
  "list-loop",
  "single-loop",
  "shuffle",
  "sequence",
];

const PLAY_MODE_LABELS: Record<PlayModeId, string> = {
  "list-loop": "列表循环",
  "single-loop": "单曲循环",
  shuffle: "随机播放",
  sequence: "顺序播放",
};

const PLAY_MODE_STATES: Record<PlayModeId, PlayModeState> = {
  "list-loop": { repeatMode: "all", isShuffle: false },
  "single-loop": { repeatMode: "one", isShuffle: false },
  shuffle: { repeatMode: "all", isShuffle: true },
  sequence: { repeatMode: "off", isShuffle: false },
};

export function getPlayModeControl(state: PlayModeState): PlayModeControl {
  if (state.isShuffle) {
    return { id: "shuffle", label: PLAY_MODE_LABELS.shuffle };
  }
  if (state.repeatMode === "one") {
    return { id: "single-loop", label: PLAY_MODE_LABELS["single-loop"] };
  }
  if (state.repeatMode === "all") {
    return { id: "list-loop", label: PLAY_MODE_LABELS["list-loop"] };
  }
  return { id: "sequence", label: PLAY_MODE_LABELS.sequence };
}

export function getNextPlayMode(mode: PlayModeId): PlayModeId {
  const currentIndex = PLAY_MODE_SEQUENCE.indexOf(mode);
  if (currentIndex < 0) return PLAY_MODE_SEQUENCE[0];
  return PLAY_MODE_SEQUENCE[(currentIndex + 1) % PLAY_MODE_SEQUENCE.length];
}

export function getPlayModeState(mode: PlayModeId): PlayModeState {
  return PLAY_MODE_STATES[mode];
}
