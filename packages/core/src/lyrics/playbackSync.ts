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
 * - 滞后带仅对「前进进入新行」生效——越过该行起点不足 hysteresis 时仍停留
 *   上一行；回退（seek 往回落在行中部）立即生效不受影响。
 *
 * 历史注记：本模块曾与桌面 `services/lyrics/playbackSync`（超集：词级进度、
 * 时钟外推）、移动端 playerService 手抄副本三份并存且互相漂移（lead 有无、
 * 首行前返 0 还是 -1）。现收敛为本实现，桌面端迁移前仍用其本地副本。
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
