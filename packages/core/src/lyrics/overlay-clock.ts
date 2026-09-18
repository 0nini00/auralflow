import {
  findCurrentLyricLineIndex,
  type FindCurrentLyricLineOptions,
  type TimedLyricLine,
} from "./playbackSync";

export interface OverlayTickSchedule {
  /** 当前歌词行索引，未唱到首行或无歌词为 -1 */
  currentLineIndex: number;
  /** 下一次行切换还需等待的毫秒数；若已是末行或无后续事件则为 null */
  nextDelayMs: number | null;
}

export interface ScheduleOverlayTickOptions extends FindCurrentLyricLineOptions {}

/** 前台校准阈值（毫秒）：超过该时长未收到校准事件且在前台时需要校准一次 */
export const OVERLAY_CLOCK_CALIBRATION_THRESHOLD_MS = 5000;

/**
 * 计算悬浮歌词时钟调度的当前行索引及到下一行的毫秒延迟。
 *
 * 语义：
 * 1. 若 lines 为空，返回 currentLineIndex = -1, nextDelayMs = null；
 * 2. 通过 findCurrentLyricLineIndex 获取当前行；
 * 3. 若处于首行前（currentLineIndex = -1）：下一行为 lines[0]，延迟为 (lines[0].time - position) / rate；
 * 4. 若处于末行（currentLineIndex = lines.length - 1）：无下一行，nextDelayMs = null；
 * 5. 处于普通行：下一行为 lines[currentLineIndex + 1]，延迟为 (next.time - position) / rate；
 * 6. 非法或 <= 0 的 rate 自动规整为 1。
 */
export function scheduleOverlayTick(
  lines: readonly TimedLyricLine[],
  position: number,
  rate = 1,
  options?: ScheduleOverlayTickOptions,
): OverlayTickSchedule {
  if (lines.length === 0) {
    return { currentLineIndex: -1, nextDelayMs: null };
  }

  const effectiveRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const currentLineIndex = findCurrentLyricLineIndex(lines, position, options);

  // 尚未唱到首行：等待首行起点
  if (currentLineIndex < 0) {
    const firstLineTime = lines[0].time;
    const diffSeconds = Math.max(0, firstLineTime - position);
    return {
      currentLineIndex: -1,
      nextDelayMs: Math.round((diffSeconds / effectiveRate) * 1000),
    };
  }

  // 已到末行：无后续行调度
  if (currentLineIndex >= lines.length - 1) {
    return {
      currentLineIndex,
      nextDelayMs: null,
    };
  }

  // 处于普通行：调度下一行
  const nextLineTime = lines[currentLineIndex + 1].time;
  const diffSeconds = Math.max(0, nextLineTime - position);
  return {
    currentLineIndex,
    nextDelayMs: Math.round((diffSeconds / effectiveRate) * 1000),
  };
}

/**
 * 判断是否需要校准悬浮歌词时钟。
 * 仅在前台且自上次同步经过的时长 >= thresholdMs 时需要校准。
 */
export function shouldCalibrateClock(
  elapsedSinceLastSyncMs: number,
  isForeground: boolean,
  thresholdMs: number = OVERLAY_CLOCK_CALIBRATION_THRESHOLD_MS,
): boolean {
  if (!isForeground) return false;
  return elapsedSinceLastSyncMs >= thresholdMs;
}
