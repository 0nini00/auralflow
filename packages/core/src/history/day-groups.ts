/**
 * 播放历史的「按天」口径 —— 双端共用的纯逻辑。
 *
 * 只认宿主本地日历日：今天 / 昨天 / M月D日 / YYYY年M月D日，全部用本地 `Date` getter 计算，
 * 不做 UTC 归一，也不假设一天固定 24 小时（夏令时切换日由 `addDays` 的日历运算处理）。
 * `playedAt <= 0` 视为「时间未知」，不参与任何按天分组。
 */

export interface DayGroup<T> {
  /** 今天 / 昨天 / M月D日 / YYYY年M月D日 */
  title: string;
  /** 该本地日 00:00 的毫秒时间戳 */
  dayStart: number;
  entries: T[];
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function dayStartOf(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 使用本地日历日期加减，夏令时切换日不一定是 24 小时。 */
export function addDays(dayStart: number, n: number): number {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n).getTime();
}

/** 月导航从月初计算，避免 31 日切到短月时溢出。 */
export function addMonths(time: number, n: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth() + n, 1).getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return dayStartOf(a) === dayStartOf(b);
}

export function formatHistoryDayTitle(dayStart: number, now = Date.now()): string {
  const date = new Date(dayStart);
  const nowDate = new Date(now);
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();

  if (dayStart === todayStart) return "今天";
  if (dayStart === addDays(todayStart, -1)) return "昨天";
  return date.getFullYear() === nowDate.getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 按本地日分组，组与组内条目都按时间倒序；时间未知（<=0）的条目被忽略。 */
export function groupEntriesByDay<T extends { playedAt: number }>(
  entries: readonly T[],
  now = Date.now(),
): DayGroup<T>[] {
  const groups = new Map<number, T[]>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.playedAt) || entry.playedAt <= 0) continue;
    const dayStart = dayStartOf(entry.playedAt);
    const list = groups.get(dayStart) ?? [];
    list.push(entry);
    groups.set(dayStart, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([dayStart, list]) => ({
      dayStart,
      title: formatHistoryDayTitle(dayStart, now),
      entries: [...list].sort((a, b) => b.playedAt - a.playedAt),
    }));
}

export function filterEntriesByDay<T extends { playedAt: number }>(
  entries: readonly T[],
  dayStart: number,
): T[] {
  const start = dayStartOf(dayStart);
  const end = addDays(start, 1);
  return entries
    .filter((entry) => entry.playedAt >= start && entry.playedAt < end)
    .sort((a, b) => b.playedAt - a.playedAt);
}

export interface HistoryCalendarDay {
  dayStart: number;
  /** 未来日期或当天没有播放记录 */
  disabled: boolean;
  selected: boolean;
}

/**
 * 月历格子（7 列），`recordedDays` 是已有播放记录的本地日 00:00 时间戳集合。
 * 前后补空位，保证第一格是周日、行数按需计算。
 */
export function getMonthCalendarDays(
  recordedDays: Iterable<number>,
  month: number,
  selectedDay: number,
  now = Date.now(),
): (HistoryCalendarDay | null)[] {
  const first = new Date(addMonths(month, 0));
  const year = first.getFullYear();
  const monthIndex = first.getMonth();
  const offset = first.getDay();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((offset + dayCount) / 7) * 7;
  const today = dayStartOf(now);
  const recorded = new Set([...recordedDays].map(dayStartOf));

  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > dayCount) return null;
    const dayStart = new Date(year, monthIndex, day).getTime();
    return {
      dayStart,
      disabled: dayStart > today || !recorded.has(dayStart),
      selected: dayStart === selectedDay,
    };
  });
}
