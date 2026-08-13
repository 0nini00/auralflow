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
  /** 最近一次播放时间戳（毫秒） */
  playedAt: number;
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

function dayStartOf(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 按「今天 / 昨天 / 具体日期」对条目分组，保持每组内时间倒序。 */
export function groupHistoryEntries(entries: HistoryEntry[]): HistoryGroup[] {
  const todayStart = dayStartOf(Date.now());
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const dayStart = dayStartOf(entry.playedAt);
    let title: string;
    if (dayStart === todayStart) {
      title = "今天";
    } else if (dayStart === todayStart - DAY_MS) {
      title = "昨天";
    } else {
      const date = new Date(dayStart);
      const now = new Date();
      // 同年省略年份，跨年（或早于今年）补全年份，避免歧义。
      title = date.getFullYear() === now.getFullYear()
        ? `${date.getMonth() + 1}月${date.getDate()}日`
        : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    }
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
