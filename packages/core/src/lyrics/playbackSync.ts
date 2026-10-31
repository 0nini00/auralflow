export interface TimedLyricLine {
  time: number;
  text?: string;
  words?: readonly TimedLyricWord[];
}

export interface TimedLyricWord {
  start: number;
  dur: number;
}

/** 默认提前量（秒）：行起点前 0.08s 即切入，补偿听感延迟。 */
export const DEFAULT_LYRIC_LEAD_SECONDS = 0.08;

/** 行切换滞后带（秒）：前进进入新行需越过行起点 0.12s 才确认切换。 */
export const LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS = 0.12;

export interface FindCurrentLyricLineOptions {
  /** 提前量：target = position + lead（桌面端 0.08，移动端 0）。 */
  leadSeconds?: number;
  /** 滞后带：前进进入新行需越过行起点该时长才确认（吸收进度插值在行边界的锯齿）。 */
  hysteresisSeconds?: number;
}

/**
 * 定位当前应高亮的歌词行（唯一真相源）。
 *
 * 语义：
 * - 歌词为空、或尚未唱到首行（position + lead < 首行起点）→ 返回 -1，
 *   调用方据 -1 显示空态而非预高亮首行；
 * - 二分查找最后一个 time <= position + lead 的行；
 * - 滞后带是无状态的：落点与该行起点距离小于 hysteresis 时停留上一行。
 *   这对「进度插值在行边界的锯齿」有效；但它无法区分「前进刚过边界」与
 *   「seek 落在行起点后一小段」——后者也会停留上一行 0.12s 内。需要严格
 *   方向性（记住上一行号）的场景由调用方自行比较前后两次返回值。
 *
 * 历史注记：本模块曾与桌面 `services/lyrics/playbackSync`（超集：词级进度、
 * 时钟外推）、移动端 playerService 手抄副本三份并存且互相漂移（lead 有无、
 * 首行前返 0 还是 -1）。行定位已收敛到本实现；词级进度与时钟外推随后也从
 * 桌面副本迁入（见下方 `calculateLyricLineProgress` / `estimatePlaybackProgress`），
 * 桌面只剩「首行前预高亮第一行」这一层 UI 语义包装。
 */
export function findCurrentLyricLineIndex(
  lines: readonly TimedLyricLine[],
  position: number,
  options?: FindCurrentLyricLineOptions,
): number {
  if (lines.length === 0) return -1;

  const lead = options?.leadSeconds ?? 0;
  const hysteresis = options?.hysteresisSeconds ?? 0;
  const targetTime = position + lead;
  if (!Number.isFinite(targetTime) || targetTime < lines[0].time) return -1;

  let low = 0;
  let high = lines.length - 1;
  let current = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].time <= targetTime) {
      current = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (current < 0) return -1;
  if (current > 0 && hysteresis > 0 && targetTime - lines[current].time < hysteresis) {
    return current - 1;
  }
  return current;
}

// ─── 行进度（卡拉OK / 进度条填充） ──────────────────────────────

/** 无字级时间时的行时长兜底（秒）。 */
const DEFAULT_LYRIC_LINE_DURATION_SECONDS = 4;
/** 文本时长估计的上限：长间隙（间奏）也不该把进度拉得无限慢。 */
const MAX_LYRIC_LINE_PROGRESS_SECONDS = 4.5;
/** 文本时长估计的下限：极短行（"Wow"）也要有可见的进度过程。 */
const MIN_ESTIMATED_LYRIC_LINE_PROGRESS_SECONDS = 1.1;
/** 无字级时间时按文本构成估时长的权重（秒/单位），来自实测听感。 */
const CJK_LYRIC_CHAR_SECONDS = 0.24;
const LATIN_LYRIC_WORD_SECONDS = 0.42;
const OTHER_LYRIC_CHAR_SECONDS = 0.16;
const LYRIC_LINE_PROGRESS_BASE_SECONDS = 0.65;

/** 播放引擎的进度采样；`updatedAt` 用墙钟，跨 WebView（桌面歌词窗）仍可用。 */
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

/** 无字级时间的行按时文本构成估时长；无文本返回 null（调用方用兜底值）。 */
function estimateUntimedLyricLineDuration(line: TimedLyricLine): number | null {
  const text = line.text?.trim();
  if (!text) return null;

  const estimated = LYRIC_LINE_PROGRESS_BASE_SECONDS + getUntimedLyricWeight(text);
  return clampDuration(
    estimated,
    MIN_ESTIMATED_LYRIC_LINE_PROGRESS_SECONDS,
    MAX_LYRIC_LINE_PROGRESS_SECONDS,
  );
}

function getWordAbsoluteStart(lineStart: number, word: TimedLyricWord): number {
  const wordStart = finiteNonNegative(word.start);
  // word.start 可能是绝对时间，也可能是相对行首
  return wordStart >= lineStart ? wordStart : lineStart + wordStart;
}

function getWordAbsoluteEnd(lineStart: number, word: TimedLyricWord): number {
  return getWordAbsoluteStart(lineStart, word) + finiteNonNegative(word.dur);
}

/**
 * 有逐字时间轴时，按「已完成字 + 当前字内插值」算行进度，比「整行线性」更贴合卡拉 OK 动效。
 * 返回 null 表示字级时间不可用，应回退到行级估算。
 */
export function calculateWordLevelLineProgress(
  line: TimedLyricLine,
  currentTime: number,
): number | null {
  if (!line.words?.length) return null;
  const lineStart = finiteNonNegative(line.time);
  const words = line.words;
  const t = finiteNonNegative(currentTime);

  // 第一个字还没开始
  const firstStart = getWordAbsoluteStart(lineStart, words[0]);
  if (t <= firstStart) return 0;

  const lastEnd = getWordAbsoluteEnd(lineStart, words[words.length - 1]);
  if (lastEnd <= firstStart) return null;
  if (t >= lastEnd) return 1;

  let completed = 0;
  for (let i = 0; i < words.length; i++) {
    const wStart = getWordAbsoluteStart(lineStart, words[i]);
    const wEnd = getWordAbsoluteEnd(lineStart, words[i]);
    const dur = Math.max(0, wEnd - wStart);
    if (t >= wEnd) {
      completed += 1;
      continue;
    }
    if (t <= wStart) {
      return clamp01(completed / words.length);
    }
    // 当前字内
    const frac = dur > 0 ? (t - wStart) / dur : 1;
    return clamp01((completed + clamp01(frac)) / words.length);
  }
  return 1;
}

function getLineTimedEnd(line: TimedLyricLine): number | null {
  if (!line.words?.length) return null;

  const lineStart = finiteNonNegative(line.time);
  const lastWordEnd = line.words.reduce((end, word) => {
    return Math.max(end, getWordAbsoluteEnd(lineStart, word));
  }, lineStart);

  return lastWordEnd > lineStart ? lastWordEnd : null;
}

/**
 * 由播放时钟外推当前进度（桌面歌词窗与 WebView 主窗口共享同一墙钟基准）。
 *
 * 非 playing 状态不外推；时钟超过 1.5s 未刷新（后台挂起 / 标签页冻结）时也不外推，
 * 避免歌词在恢复可见的瞬间冲过头。
 */
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
  if (elapsedSeconds > 1.5) {
    return duration > 0 ? Math.min(progress, duration) : progress;
  }

  const estimated = progress + elapsedSeconds * playbackRate;
  return duration > 0 ? Math.min(estimated, duration) : estimated;
}

/**
 * 当前行内进度（0..1）。
 *
 * 优先字级进度（YRC/QRC/KRC）；无字级时间时用「下一行间隙」与「文本时长估计」
 * 调和——间隙特别大（间奏）时进度在估计时长内走完并停在 1，短间隙则跟间隙走。
 */
export function calculateLyricLineProgress(
  lines: readonly TimedLyricLine[],
  currentLine: number,
  currentTime: number,
  fallbackDuration = DEFAULT_LYRIC_LINE_DURATION_SECONDS,
): number {
  const line = lines[currentLine];
  if (!line) return 0;

  const wordProgress = calculateWordLevelLineProgress(line, currentTime);
  if (wordProgress != null) return wordProgress;

  const start = finiteNonNegative(line.time);
  const timedEnd = getLineTimedEnd(line);
  const nextTime = lines[currentLine + 1]?.time;
  const nextLineGap = Number.isFinite(nextTime) && nextTime! > start ? nextTime! - start : null;
  const fallbackLineDuration = Math.max(0.5, fallbackDuration);
  const estimatedDuration = estimateUntimedLyricLineDuration(line) ?? fallbackLineDuration;

  let untimedDuration: number;
  if (nextLineGap != null) {
    untimedDuration = Math.min(nextLineGap, Math.max(estimatedDuration, MIN_ESTIMATED_LYRIC_LINE_PROGRESS_SECONDS));
    if (nextLineGap < estimatedDuration) untimedDuration = nextLineGap;
  } else {
    untimedDuration = estimatedDuration;
  }

  const timedDuration = timedEnd && timedEnd > start
    ? nextLineGap != null
      ? Math.min(timedEnd - start, nextLineGap)
      : timedEnd - start
    : null;
  const duration = Math.max(0.5, timedDuration ?? untimedDuration);

  return clamp01((currentTime - start) / duration);
}
