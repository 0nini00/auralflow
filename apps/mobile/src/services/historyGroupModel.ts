import type { MusicInfo } from "@lx/core";

/**
 * 播放历史「分时间记录」模型（对齐 lx）：
 * - 历史以条目存储（每条含 playedAt），同一天同一首歌只记一条，跨天保留多次播放；
 * - 展示按时间分组：今天 / 昨天 / M月D日（近 7 天）/ YYYY年M月D日（更早）。
 */

export interface HistoryEntry {
  /** 去重键：source:id */
  key: string;
  song: MusicInfo;
  /**
   * 本地时间基准（毫秒）：分组 / 31 天滚动窗口 / 同日去重 / 排序都用它。
   *
   * **它不一定等于真实播放时间**：云端条目没带时间、或旧格式落盘数据没有时间戳时，
   * 为了让条目不掉出 31 天窗口会就地补一个占位时间，此时 `playedAtSynthetic = true`。
   */
  playedAt: number;
  /**
   * `playedAt` 是否为**合成占位时间**（即「时间未知」）：
   * - `true`：只用于本地分组/排序/滚动窗口。统计按时间未知处理（不进按天趋势），
   *   WebDAV 导出一律写 `playedAt: 0`（与桌面端一致的未知哨兵），绝不冒充真实播放时间；
   * - 缺失：真实记录过的播放时间（升级前落盘的数据没有标记，按本地既有数据原样保留）。
   */
  playedAtSynthetic?: boolean;
}

/**
 * 该条目是否带**真实**播放时间。
 * 合成占位时间与非法值（非有限数 / `<= 0`）都算「时间未知」，与桌面端
 * `isUsablePlayedAt`（`desktop/src/stores/historyStore.ts:65`）以及 core
 * `aggregateListeningStats` 的 `toPositiveTimestamp`（`packages/core/src/stats/aggregate.ts:140`）同口径。
 */
export function hasRealPlayedAt(entry: HistoryEntry): boolean {
  return entry.playedAtSynthetic !== true && Number.isFinite(entry.playedAt) && entry.playedAt > 0;
}

export interface HistoryGroup {
  title: string;
  entries: HistoryEntry[];
}

export function historySongKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

function toDateText(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dayStartOf(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** 按「今天 / 昨天 / 具体日期」对条目分组，保持每组内时间倒序。 */
export function groupHistoryEntries(entries: HistoryEntry[]): HistoryGroup[] {
  const todayStart = dayStartOf(Date.now());
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const dayStart = dayStartOf(entry.playedAt);
    const title = formatHistoryDayTitle(dayStart, todayStart);
    const list = groups.get(title) ?? [];
    list.push(entry);
    groups.set(title, list);
  }
  return [...groups.entries()].map(([title, list]) => ({
    title,
    // 同一标题内按播放时间倒序（entries 已整体倒序，这里防御性再排一次）
    entries: [...list].sort((a, b) => b.playedAt - a.playedAt),
  }));
}

/** 判断两个时间戳是否属于同一天（用于「同一天同一首歌去重」）。 */
export function isSameDay(a: number, b: number): boolean {
  return toDateText(new Date(a)) === toDateText(new Date(b));
}

export function filterEntriesByDay(entries: HistoryEntry[], dayStart: number): HistoryEntry[] {
  const start = dayStartOf(dayStart);
  const end = addDays(start, 1);
  return entries
    .filter((e) => e.playedAt >= start && e.playedAt < end)
    .sort((a, b) => b.playedAt - a.playedAt);
}

/** 使用本地日历日期，夏令时切换日不一定是 24 小时。 */
export function addDays(dayStart: number, n: number): number {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n).getTime();
}

export function formatHistoryDayTitle(dayStart: number, now = Date.now()): string {
  const date = new Date(dayStart);
  const nowDate = new Date(now);
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();

  if (dayStart === todayStart) {
    return "今天";
  } else if (dayStart === addDays(todayStart, -1)) {
    return "昨天";
  } else {
    return date.getFullYear() === nowDate.getFullYear()
      ? `${date.getMonth() + 1}月${date.getDate()}日`
      : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
}

/** 月导航从月初计算，避免 31 日切到短月时溢出。 */
export function addMonths(time: number, n: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth() + n, 1).getTime();
}

export interface HistoryCalendarDay {
  dayStart: number;
  disabled: boolean;
  selected: boolean;
}

/** 日历只标记真实播放日；合成时间仍按既有规则在历史列表中展示。 */
export function getHistoryCalendarDays(
  entries: HistoryEntry[],
  month: number,
  selectedDay: number,
  now = Date.now(),
): (HistoryCalendarDay | null)[] {
  const first = new Date(addMonths(month, 0));
  const year = first.getFullYear();
  const monthIndex = first.getMonth();
  const offset = first.getDay();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const weekLength = 7;
  const cellCount = Math.ceil((offset + dayCount) / weekLength) * weekLength;
  const today = dayStartOf(now);
  const recordedDays = new Set(entries.filter(hasRealPlayedAt).map((entry) => dayStartOf(entry.playedAt)));

  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > dayCount) return null;
    const dayStart = new Date(year, monthIndex, day).getTime();
    return {
      dayStart,
      disabled: dayStart > today || !recordedDays.has(dayStart),
      selected: dayStart === selectedDay,
    };
  });
}
