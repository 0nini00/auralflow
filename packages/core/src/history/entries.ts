import type { MusicInfo } from "../sources";
import type { HistoryPlayEntry } from "../stats/aggregate";
import { dayStartOf } from "./day-groups";

/**
 * 播放历史条目 —— 双端按天记录的统一形状。
 *
 * 同一天同一首歌只留一条（刷新播放时间），跨天保留多次播放。
 * `playedAt: 0` 表示**时间未知**（升级前没有时间戳、云端条目没带 playedAt）：
 * 它仍然是一条历史记录，但不参与按天分组，也不会被当成真实播放时间回传云端。
 */
export interface HistoryEntry {
  /** 去重键 `${source}:${id}` */
  key: string;
  song: MusicInfo;
  /** 真实播放时间（毫秒）；0 = 时间未知 */
  playedAt: number;
}

/** 与移动端 `MAX_HISTORY_ITEMS` 一致：WebDAV 会按本地上限截断后回写云端。 */
export const HISTORY_MAX_ENTRIES = 2000;

export function historyEntryKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

/** 可用的真实播放时间：正的有限毫秒数。0 / 负数 / NaN / 非数字一律「时间未知」。 */
export function isUsablePlayedAt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function dedupeKey(entry: HistoryEntry): string {
  const day = isUsablePlayedAt(entry.playedAt) ? dayStartOf(entry.playedAt) : 0;
  return `${entry.key}:${day}`;
}

/**
 * 规整：丢掉没有 id/key 的坏条目，同 key 同本地日只留时间较新的一条，
 * 按时间倒序（未知时间排最后）截断到上限。
 */
export function normalizeHistoryEntries(
  entries: readonly HistoryEntry[],
  maxEntries = HISTORY_MAX_ENTRIES,
): HistoryEntry[] {
  const kept = new Map<string, HistoryEntry>();
  for (const entry of entries) {
    if (!entry || !entry.key || !entry.song?.id) continue;
    const playedAt = isUsablePlayedAt(entry.playedAt) ? entry.playedAt : 0;
    const next: HistoryEntry = { key: entry.key, song: entry.song, playedAt };
    const id = dedupeKey(next);
    const previous = kept.get(id);
    if (!previous || next.playedAt > previous.playedAt) kept.set(id, next);
  }
  // 同一首歌只要有一条真实播放时间，就不再保留「时间未知」的占位条目：
  // 未知条目进不了任何按天视图，留着只会在「时间未知」里重复一份。
  const withRealTime = new Set(
    [...kept.values()].filter((entry) => entry.playedAt > 0).map((entry) => entry.key),
  );
  return [...kept.values()]
    .filter((entry) => entry.playedAt > 0 || !withRealTime.has(entry.key))
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, Math.max(0, maxEntries));
}

/**
 * 追加一次播放：同一天同一首歌只保留一条（把时间刷新到本次），
 * 跨天则新增一条；结果按时间倒序截断。
 */
export function addHistoryEntry(
  entries: readonly HistoryEntry[],
  song: MusicInfo,
  playedAt: number = Date.now(),
  maxEntries = HISTORY_MAX_ENTRIES,
): HistoryEntry[] {
  if (!song?.id) return [...entries];
  const key = historyEntryKey(song);
  const day = dayStartOf(playedAt);
  const rest = entries.filter(
    (entry) => !(entry.key === key && isUsablePlayedAt(entry.playedAt) && dayStartOf(entry.playedAt) === day),
  );
  return normalizeHistoryEntries([{ key, song, playedAt }, ...rest], maxEntries);
}

/**
 * 合并本地与远端（WebDAV）：按 key + 本地日去重，同一格保留时间较新的条目。
 * 时间未知的条目只有在同一天没有真实记录时才会留下（归一化时真实时间更大，自然胜出）。
 */
export function mergeHistoryEntries(
  local: readonly HistoryEntry[],
  remote: readonly HistoryEntry[],
  maxEntries = HISTORY_MAX_ENTRIES,
): HistoryEntry[] {
  return normalizeHistoryEntries([...local, ...remote], maxEntries);
}

/** 由条目派生唯一歌曲列表（最近优先），供「最近播放」封面 / 计数等既有入口使用。 */
export function historySongs(entries: readonly HistoryEntry[]): MusicInfo[] {
  const seen = new Set<string>();
  const songs: MusicInfo[] = [];
  for (const entry of entries) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    songs.push(entry.song);
  }
  return songs;
}

/** 统计入参：时间未知的条目不填 playedAt（只进总数/榜单，不进按天趋势）。 */
export function toHistoryPlayEntries(entries: readonly HistoryEntry[]): HistoryPlayEntry[] {
  return entries.map((entry) =>
    isUsablePlayedAt(entry.playedAt)
      ? { song: entry.song, playedAt: entry.playedAt }
      : { song: entry.song },
  );
}
