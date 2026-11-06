import type { MusicInfo } from "@lx/core";
import {
  DAY_MS,
  addDays,
  addMonths,
  dayStartOf,
  filterEntriesByDay as filterEntriesByLocalDay,
  formatHistoryDayTitle,
  getMonthCalendarDays,
  groupEntriesByDay,
  isSameDay,
  type HistoryCalendarDay,
} from "@lx/core";

/**
 * 播放历史「分时间记录」模型：
 * - 历史以条目存储（每条含 playedAt），同一天同一首歌只记一条，跨天保留多次播放；
 * - 展示按时间分组：今天 / 昨天 / M月D日（近 7 天）/ YYYY年M月D日（更远）。
 *
 * 日期口径（本地日归零、日历加减、今天/昨天标题、月历格子）已上提到 `@lx/core`，
 * 桌面端与移动端共用同一份实现；这里只保留带 `playedAtSynthetic` 的移动端条目语义。
 */

export interface HistoryEntry {
  /** 去重键：source:id */
  key: string;
  song: MusicInfo;
  /**
   * 本地时间基准（毫秒）：分组 / 同日去重 / 排序都用它。
   *
   * **它不一定等于真实播放时间**：云端条目没带时间、或旧格式落盘数据没有时间戳时，
   * 为了让旧条目仍能参与分组会就地补一个占位时间，此时 `playedAtSynthetic = true`。
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
 * `isUsablePlayedAt`（`@lx/core` 的 `history/entries.ts`）同口径。
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

export { DAY_MS, addDays, addMonths, dayStartOf, formatHistoryDayTitle, isSameDay, type HistoryCalendarDay };

/** 按「今天 / 昨天 / 具体日期」对条目分组，保持每组内时间倒序。 */
export function groupHistoryEntries(entries: HistoryEntry[]): HistoryGroup[] {
  return groupEntriesByDay(entries).map(({ title, entries: grouped }) => ({ title, entries: grouped }));
}

export function filterEntriesByDay(entries: HistoryEntry[], dayStart: number): HistoryEntry[] {
  return filterEntriesByLocalDay(entries, dayStart);
}

/** 日历只标记真实播放日；合成时间仍按既有规则在历史列表中展示。 */
export function getHistoryCalendarDays(
  entries: HistoryEntry[],
  month: number,
  selectedDay: number,
  now = Date.now(),
): (HistoryCalendarDay | null)[] {
  const recordedDays = entries.filter(hasRealPlayedAt).map((entry) => dayStartOf(entry.playedAt));
  return getMonthCalendarDays(recordedDays, month, selectedDay, now);
}
