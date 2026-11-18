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
  // 跨 30 秒才落盘：0.25s 的进度 tick 每 10s 序列化整个队列一次，大队列每次几 ms
  // 挤 JS 线程；崩溃丢失窗口从 10s 放大到 30s，换来的流畅是净收益。
  if (Math.floor(current.position / 30) !== Math.floor(previous.position / 30)) return "progress";
  return "none";
}

export function isPlaybackSnapshotEmpty(snapshot: {
  currentSong: unknown;
  queue: readonly unknown[];
}): boolean {
  return snapshot.currentSong == null && snapshot.queue.length === 0;
}

/** 心动模式（已下线）写进快照的播放上下文类型。 */
const RETIRED_HEARTBEAT_CONTEXT_TYPE = "heartbeat";

/**
 * 快照里的播放上下文是否属于已下线的心动模式。
 *
 * 快照是磁盘上的外部输入：带心动模式的旧版本会把它的上下文原样写进去，
 * 而 `PlaybackContext` 类型里已经没有这一支，所以这里按 unknown 判断。
 */
export function isRetiredHeartbeatContext(playbackContext: unknown): boolean {
  if (typeof playbackContext !== "object" || playbackContext === null) return false;
  return (playbackContext as { type?: unknown }).type === RETIRED_HEARTBEAT_CONTEXT_TYPE;
}
