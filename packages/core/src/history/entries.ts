import type { MusicInfo } from "../sources";
import type { HistoryPlayEntry } from "../stats/aggregate";
import { addDays, dayStartOf } from "./day-groups";

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

/**
 * 本地保留策略：最近 365 天、最多 4000 条、时间未知最多 200 条。
 *
 * 只按条数截断的问题是「深度不可预期」：40 首/天的人 50 天就满，8 首/天的人能放 250 天。
 * 所以先按天定窗口，再用条数兜底（移动端 AsyncStorage 与 WebDAV 都不能无限长）；
 * 超限时**按整天裁剪**，避免把一个自然日切成半天。
 */
export const HISTORY_RETENTION_DAYS = 365;
export const HISTORY_MAX_ENTRIES = 4000;
export const HISTORY_MAX_UNKNOWN_ENTRIES = 200;

/**
 * WebDAV 上传窗口：只传最近 180 天、最多 2000 条。
 * 本地保留不受影响；新设备同步后能拿到最近半年，单次同步的 JSON 控制在 ~1MB 内。
 */
export const HISTORY_SYNC_DAYS = 180;
export const HISTORY_SYNC_MAX_ENTRIES = 2000;

export interface HistoryPruneOptions {
  now?: number;
  retentionDays?: number;
  maxEntries?: number;
  maxUnknownEntries?: number;
}

export function historyEntryKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

/** 可用的真实播放时间：正的有限毫秒数。0 / 负数 / NaN / 非数字一律「时间未知」。 */
export function isUsablePlayedAt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 历史快照裁剪：`img` 与 `picUrl` 指向同一张图时只留 `img`。
 * 双端歌曲列表都按 `img || picUrl` 取封面，去掉重复的那份不改变显示，单条省约 120 字节。
 */
export function trimHistorySong(song: MusicInfo): MusicInfo {
  if (!song?.img || !song.picUrl || song.img !== song.picUrl) return song;
  const next = { ...song };
  delete next.picUrl;
  return next;
}

/**
 * 保留策略：时间窗口 → 按整天截断 → 时间未知单独限量。
 *
 * - 只保留最近 `retentionDays` 个本地日（含今天）；
 * - 真实条目按天倒序累加，某一天放不下就整体丢弃，不再从更早的日期里东拼西凑；
 * - 时间未知的条目不占正常预算，但该曲只要已有真实记录就不再保留，且最多 `maxUnknownEntries` 条。
 */
export function pruneHistoryEntries<T extends HistoryEntry>(
  entries: readonly T[],
  options: HistoryPruneOptions = {},
): T[] {
  const now = options.now ?? Date.now();
  const retentionDays = Math.max(1, options.retentionDays ?? HISTORY_RETENTION_DAYS);
  const maxEntries = Math.max(0, options.maxEntries ?? HISTORY_MAX_ENTRIES);
  const maxUnknownEntries = Math.max(0, options.maxUnknownEntries ?? HISTORY_MAX_UNKNOWN_ENTRIES);

  const real: T[] = [];
  const unknown: T[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (isUsablePlayedAt(entry.playedAt)) real.push(entry);
    else unknown.push(entry);
  }

  const cutoff = addDays(dayStartOf(now), -(retentionDays - 1));
  const withinWindow = real
    .filter((entry) => entry.playedAt >= cutoff)
    .sort((a, b) => b.playedAt - a.playedAt);

  const byDay = new Map<number, T[]>();
  for (const entry of withinWindow) {
    const day = dayStartOf(entry.playedAt);
    const list = byDay.get(day) ?? [];
    list.push(entry);
    byDay.set(day, list);
  }

  const kept: T[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => b - a)) {
    const list = byDay.get(day)!;
    if (kept.length >= maxEntries) break;
    if (kept.length + list.length <= maxEntries) {
      kept.push(...list);
      continue;
    }
    // 最新的一天本身超上限时，按时间留下这一天里最近的若干条。
    if (kept.length === 0) kept.push(...list.slice(0, maxEntries));
    break;
  }

  const realKeys = new Set(kept.map((entry) => entry.key));
  const unknownKept = unknown
    .filter((entry) => !realKeys.has(entry.key))
    .slice(0, maxUnknownEntries);

  return [...kept, ...unknownKept];
}

function dedupeKey(entry: HistoryEntry): string {
  const day = isUsablePlayedAt(entry.playedAt) ? dayStartOf(entry.playedAt) : 0;
  return `${entry.key}:${day}`;
}

/**
 * 规整：丢掉没有 id/key 的坏条目，同 key 同本地日只留时间较新的一条，
 * 再交给 `pruneHistoryEntries` 做时间窗口与按天截断。
 */
export function normalizeHistoryEntries(
  entries: readonly HistoryEntry[],
  maxEntries = HISTORY_MAX_ENTRIES,
  now = Date.now(),
): HistoryEntry[] {
  const kept = new Map<string, HistoryEntry>();
  for (const entry of entries) {
    if (!entry || !entry.key || !entry.song?.id) continue;
    const playedAt = isUsablePlayedAt(entry.playedAt) ? entry.playedAt : 0;
    const next: HistoryEntry = { key: entry.key, song: trimHistorySong(entry.song), playedAt };
    const id = dedupeKey(next);
    const previous = kept.get(id);
    if (!previous || next.playedAt > previous.playedAt) kept.set(id, next);
  }
  return pruneHistoryEntries([...kept.values()], { now, maxEntries });
}

/**
 * 追加一次播放：同一天同一首歌只保留一条（把时间刷新到本次），
 * 跨天则新增一条；结果按时间倒序并按保留策略裁剪。
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
  return normalizeHistoryEntries(
    [{ key, song: trimHistorySong(song), playedAt }, ...rest],
    maxEntries,
    playedAt,
  );
}

/**
 * 合并本地与远端（WebDAV）：按 key + 本地日去重，同一格保留时间较新的条目。
 * 时间未知的条目只有在同一天没有真实记录时才会留下（真实时间更大，归一化时自然胜出）。
 */
export function mergeHistoryEntries(
  local: readonly HistoryEntry[],
  remote: readonly HistoryEntry[],
  maxEntries = HISTORY_MAX_ENTRIES,
): HistoryEntry[] {
  return normalizeHistoryEntries([...local, ...remote], maxEntries);
}

/** 上传前裁剪：只保留最近 180 天 / 最多 2000 条，本地数据不受影响。 */
export function selectHistoryForSync<T extends HistoryEntry>(
  entries: readonly T[],
  now = Date.now(),
): T[] {
  return pruneHistoryEntries(entries, {
    now,
    retentionDays: HISTORY_SYNC_DAYS,
    maxEntries: HISTORY_SYNC_MAX_ENTRIES,
    maxUnknownEntries: HISTORY_MAX_UNKNOWN_ENTRIES,
  });
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
