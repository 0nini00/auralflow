export type SnapshotSaveTrigger = "none" | "structural" | "progress" | "pause";

export interface PlaybackSnapshotComparableState {
  currentSong: unknown;
  queue: readonly unknown[];
  currentIndex: number;
  shuffleHistory: readonly number[];
  playMode: unknown;
  playbackRate: number;
  volume: number;
  previousVolume: number;
  isMuted: boolean;
  playbackContext: unknown;
  position: number;
  isPlaying: boolean;
}

function sameValue(left: unknown, right: unknown): boolean {
  return Object.is(left, right);
}

function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
}

function hasStructuralChange(
  current: PlaybackSnapshotComparableState,
  previous: PlaybackSnapshotComparableState,
): boolean {
  return current.currentSong !== previous.currentSong
    || !sameArray(current.queue, previous.queue)
    || current.currentIndex !== previous.currentIndex
    || !sameArray(current.shuffleHistory, previous.shuffleHistory)
    || !sameValue(current.playMode, previous.playMode)
    || current.playbackRate !== previous.playbackRate
    || current.volume !== previous.volume
    || current.previousVolume !== previous.previousVolume
    || current.isMuted !== previous.isMuted
    || !sameValue(current.playbackContext, previous.playbackContext);
}

export function getPlaybackSnapshotSaveTrigger(
  current: PlaybackSnapshotComparableState,
  previous: PlaybackSnapshotComparableState,
): SnapshotSaveTrigger {
  if (hasStructuralChange(current, previous)) return "structural";
  if (previous.isPlaying && !current.isPlaying) return "pause";
  if (Math.floor(current.position / 10) !== Math.floor(previous.position / 10)) return "progress";
  return "none";
}

export function isPlaybackSnapshotEmpty(snapshot: {
  currentSong: unknown;
  queue: readonly unknown[];
}): boolean {
  return snapshot.currentSong == null && snapshot.queue.length === 0;
}
