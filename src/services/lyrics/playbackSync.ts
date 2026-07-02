export interface TimedLyricLine {
  time: number;
  text?: string;
  words?: readonly TimedLyricWord[];
}

export interface TimedLyricWord {
  start: number;
  dur: number;
}

export interface LyricScrollMetrics {
  clientHeight: number;
  lineOffsetTop: number;
  lineHeight: number;
  scrollHeight?: number;
}

export const DEFAULT_LYRIC_LEAD_SECONDS = 0.08;
export const SEEK_JUMP_SECONDS = 2;
export const USER_SCROLL_RESUME_DELAY_MS = 3000;
export const DEFAULT_LYRIC_LINE_DURATION_SECONDS = 4;
export const MAX_LYRIC_LINE_PROGRESS_SECONDS = 4.5;
export const MIN_ESTIMATED_LYRIC_LINE_PROGRESS_SECONDS = 1.1;
export const CJK_LYRIC_CHAR_SECONDS = 0.24;
export const LATIN_LYRIC_WORD_SECONDS = 0.42;
export const OTHER_LYRIC_CHAR_SECONDS = 0.16;
export const LYRIC_LINE_PROGRESS_BASE_SECONDS = 0.65;

export interface PlaybackProgressClock {
  status: string;
  progress: number;
  duration: number;
  playbackRate: number;
  updatedAt: number;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampDuration(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function getUntimedLyricWeight(text: string): number {
  const cjkMatches = text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g);
  const latinWordMatches = text.match(/[a-zA-Z0-9]+(?:['-][a-zA-Z0-9]+)*/g);
  const cjkCount = cjkMatches?.length ?? 0;
  const latinWordCount = latinWordMatches?.length ?? 0;
  const otherCount = text
    .replace(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g, "")
    .replace(/[a-zA-Z0-9]+(?:['-][a-zA-Z0-9]+)*/g, "")
    .replace(/[\s"'`“”‘’.,，。!?！？;；:：、~～…·\-—_()[\]{}<>《》【】（）]/g, "")
    .length;

  return (
    cjkCount * CJK_LYRIC_CHAR_SECONDS +
    latinWordCount * LATIN_LYRIC_WORD_SECONDS +
    otherCount * OTHER_LYRIC_CHAR_SECONDS
  );
}

export function estimateUntimedLyricLineDuration(line: TimedLyricLine): number | null {
  const text = line.text?.trim();
  if (!text) return null;

  const estimated = LYRIC_LINE_PROGRESS_BASE_SECONDS + getUntimedLyricWeight(text);
  return clampDuration(
    estimated,
    MIN_ESTIMATED_LYRIC_LINE_PROGRESS_SECONDS,
    MAX_LYRIC_LINE_PROGRESS_SECONDS,
  );
}

function getWordAbsoluteEnd(lineStart: number, word: TimedLyricWord): number {
  const wordStart = finiteNonNegative(word.start);
  const wordDuration = finiteNonNegative(word.dur);
  const absoluteStart = wordStart >= lineStart ? wordStart : lineStart + wordStart;
  return absoluteStart + wordDuration;
}

export function getLineTimedEnd(line: TimedLyricLine): number | null {
  if (!line.words?.length) return null;

  const lineStart = finiteNonNegative(line.time);
  const lastWordEnd = line.words.reduce((end, word) => {
    return Math.max(end, getWordAbsoluteEnd(lineStart, word));
  }, lineStart);

  return lastWordEnd > lineStart ? lastWordEnd : null;
}

export function estimatePlaybackProgress(
  clock: PlaybackProgressClock,
  now = Date.now(),
): number {
  const progress = finiteNonNegative(clock.progress);
  const duration = finiteNonNegative(clock.duration);
  const playbackRate = Number.isFinite(clock.playbackRate) && clock.playbackRate > 0
    ? clock.playbackRate
    : 1;

  if (clock.status !== "playing") return duration > 0 ? Math.min(progress, duration) : progress;
  if (!Number.isFinite(clock.updatedAt) || !Number.isFinite(now) || now <= clock.updatedAt) {
    return duration > 0 ? Math.min(progress, duration) : progress;
  }

  const elapsedSeconds = (now - clock.updatedAt) / 1000;
  const estimated = progress + elapsedSeconds * playbackRate;
  return duration > 0 ? Math.min(estimated, duration) : estimated;
}

export function calculateLyricLineProgress(
  lines: readonly TimedLyricLine[],
  currentLine: number,
  currentTime: number,
  fallbackDuration = DEFAULT_LYRIC_LINE_DURATION_SECONDS,
): number {
  const line = lines[currentLine];
  if (!line) return 0;

  const start = finiteNonNegative(line.time);
  const timedEnd = getLineTimedEnd(line);
  const nextTime = lines[currentLine + 1]?.time;
  const nextLineGap = Number.isFinite(nextTime) && nextTime > start ? nextTime - start : null;
  const fallbackLineDuration = Math.max(0.5, fallbackDuration);
  const estimatedDuration = estimateUntimedLyricLineDuration(line) ?? fallbackLineDuration;
  const untimedDuration = nextLineGap != null
    ? Math.min(nextLineGap, estimatedDuration)
    : estimatedDuration;
  const timedDuration = timedEnd && timedEnd > start
    ? nextLineGap != null
      ? Math.min(timedEnd - start, nextLineGap)
      : timedEnd - start
    : null;
  const duration = Math.max(0.5, timedDuration ?? untimedDuration);

  return clamp01((currentTime - start) / duration);
}

export function findCurrentLyricLine(
  lines: readonly TimedLyricLine[],
  progress: number,
  leadSeconds = DEFAULT_LYRIC_LEAD_SECONDS,
): number {
  if (lines.length === 0) return -1;

  const targetTime = progress + leadSeconds;
  if (targetTime < lines[0].time) return 0;

  let low = 0;
  let high = lines.length - 1;
  let current = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].time <= targetTime) {
      current = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return current;
}

export function calculateCenteredLyricScrollTop({
  clientHeight,
  lineOffsetTop,
  lineHeight,
  scrollHeight,
}: LyricScrollMetrics): number {
  const rawTop = lineOffsetTop + lineHeight / 2 - clientHeight / 2;
  const maxTop = typeof scrollHeight === "number"
    ? Math.max(0, scrollHeight - clientHeight)
    : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(rawTop, maxTop));
}

export function isLyricSeekJump(
  previousProgress: number,
  nextProgress: number,
  thresholdSeconds = SEEK_JUMP_SECONDS,
): boolean {
  return Math.abs(nextProgress - previousProgress) > thresholdSeconds;
}
