/**
 * 听歌统计聚合 —— 双端共用的纯逻辑。输入历史记录数组，输出数字卡片 / 榜单 / 按天趋势所需的全部数据。
 *
 * ## 输入形状（字段名与真实实现一致，未改名）
 *
 * 两端历史存储的形状**不一样**，本函数两种都直接吃：
 *
 * 1. **桌面**：`desktop/src/stores/historyStore.ts:6` 的 `history: MusicInfo[]`——条目**没有时间戳字段**，
 *    元素本身就是 `MusicInfo`（`packages/core/src/sources/types.ts:34-60`）。
 * 2. **移动**：`apps/mobile/src/services/historyGroupModel.ts:9-15` 的 `HistoryEntry`
 *    （`{ key: "source:id"; song: MusicInfo; playedAt: number }`），
 *    `apps/mobile/src/stores/historyStore.ts:43` 的 `entries` 就是它的数组。
 *    本函数只读 `song` 与 `playedAt`；`key` 忽略，去重键内部按 `${source}:${id}` 重算，
 *    与桌面 `musicKey`（`desktop/src/stores/historyStore.ts:23-25`）、移动 `historySongKey`
 *    （`apps/mobile/src/services/historyGroupModel.ts:22-24`）、core `songKey`
 *    （`packages/core/src/webdav-merge.ts:42-44`）口径相同。
 *
 * 时长字段只有一个：`MusicInfo.interval`，单位是**秒**（证据：
 * `apps/mobile/src/services/localMusicService.ts:179` 由毫秒 `Math.round(duration / 1000)` 换算而来；
 * `desktop/src/services/lyricsService.ts:292-294` 把它当 `durationSec`；
 * `packages/core/src/history/listen-threshold.ts:3` 注释「歌曲总时长（秒）」）。
 * 它是可选字段，两端都可能没有（`apps/mobile/src/services/crossSourceFallbackService.ts:14-15`
 * 记录了「网关搜索结果不带 interval」），所以这里按**可能缺失**处理。
 *
 * ## 口径
 *
 * - **播放次数**：传入数组里属于该歌曲的**条目数**，一条 = 一次。桌面 history 已按 `source:id` 去重
 *   （`desktop/src/stores/historyStore.ts:45-48`），所以桌面每首歌的次数恒为 1；移动端「同一天同曲只留
 *   一条、跨天保留多条」（`apps/mobile/src/stores/historyStore.ts:177-180`），所以移动端的次数 =
 *   历史期内该曲被播放过的**天数**。两端都没有「单曲累计播放次数」字段，这里不臆造，只用已有信息。
 * - **时长**：每个条目按自身 `song.interval × 1000` 折算后求和；`interval` 缺失 / 非数字 / `NaN` /
 *   `Infinity` / `<= 0` 的条目按 **0 ms** 计，同时计入 `playsWithoutDuration`，供 UI 注明
 *   「其中 N 次时长未知」。任何情况下不抛异常，也不让 `NaN` 进入输出。
 * - **按天切分**：按**宿主本地日历日**（本地 00:00 为界），与移动端既有分组口径一致
 *   （`dayStartOf` / `isSameDay`：`apps/mobile/src/services/historyGroupModel.ts:33-36、71-73`），
 *   因此与「今天 / 昨天」的展示语义对得上；不用 UTC 日，也不做跨时区归一。
 *   只用 ECMAScript 的 `Date` 本地 getter，不碰宿主全局。
 *   `playedAt` 缺失 / 非数字 / `NaN` / `<= 0` 的条目（典型：桌面 history 整体没有时间戳）仍计入总数与
 *   榜单，但**不进 byDay**——宁可少一天趋势，也不按数组下标编造播放时间。
 * - **排序**：次数降序 → 累计时长降序 → 兜底键升序（歌曲用 `${source}:${id}`，歌手用名称）。
 *   全部是字符串码位比较（不用 `localeCompare`：它依赖宿主 locale，会让两端结果不一致）。
 *   完全并列的顺序也固定，UI 不需要再排。
 * - **长度**：`topTracks` / `topArtists` 返回**完整排名**（不截断，UI 自己决定展示前几名）；
 *   `byDay` 只包含数据里出现过的天，按时间升序（趋势从左到右），不做 30 天补齐——窗口长度是 UI 决策。
 *
 * ## 输入容错与边界
 *
 * - `entries` 为 `null` / `undefined` / 空数组 → 全零结果，不抛。
 * - 数组里的 `null` / `undefined` / 非对象条目（落盘数据损坏）直接跳过。
 * - 判断方言：条目**有 `song` 字段**就按 `{ song, playedAt }` 解释，否则按 `MusicInfo` 本体解释；
 *   `song` 不是对象（如 `{ song: 42 }`）视为损坏条目跳过。
 * - 缺 `id`（构不成去重键）的条目仍计入 `totalPlays` / `totalMs` / `byDay`，但不进 `topTracks`。
 * - `singer` 缺失 / 非字符串 / 全空白 → 不计入 `topArtists`（否则榜单会多出无名行）。
 * - **不做 MAX_HISTORY 截断假设**：只处理传进来的数组。上限由调用方负责
 *   （桌面 `desktop/src/stores/historyStore.ts:21` = 2000，移动
 *   `apps/mobile/src/stores/historyStore.ts:14` = 2000，core 侧 webdav 合并默认
 *   `packages/core/src/webdav-merge.ts:40` = 200）。
 * - 来源已下线的历史（`bili`）应由调用方先清理（`packages/core/src/removed-source.ts:37`
 *   `dropRemovedSourceEntries`，两端读盘后都会跑）；清理前传入的 `source` 会原样出现在结果里。
 */

import type { MusicInfo } from "../sources";

/** 移动端历史条目的字段子集（`HistoryEntry`，`apps/mobile/src/services/historyGroupModel.ts:9-15`）。 */
export interface HistoryPlayEntry {
  song: MusicInfo;
  /** 播放时间戳（毫秒）；缺失或非法时该条不参与 byDay */
  playedAt?: number;
}

/** 一条历史记录：桌面传 `MusicInfo` 本体，移动传 `{ song, playedAt }` 条目。 */
export type ListeningStatsInput = MusicInfo | HistoryPlayEntry;

/** 榜单歌曲：去重键 + 代表快照 + 该曲在本次输入里的聚合值。 */
export interface ListeningStatsTrack {
  /** 去重键 `${source}:${id}`，与两端 historyStore 的键一致 */
  key: string;
  /**
   * 代表快照：**首次出现**那条记录里的 `MusicInfo`（移动端按播放时间倒序传入，即最近一次的元数据）。
   * 直接引用，不复制，可直接拿去展示或播放。
   */
  song: MusicInfo;
  /** 播放次数（条目数） */
  plays: number;
  /** 累计时长（ms），`interval` 缺失/非法的条目按 0 计 */
  totalMs: number;
}

export interface ListeningStatsArtist {
  /** 歌手名，`MusicInfo.singer` 去掉首尾空白后的原样值（「A/B」这类多歌手串整体作为一个单位，不拆分） */
  name: string;
  plays: number;
  totalMs: number;
}

export interface ListeningStatsDay {
  /** 本地日历日，格式 `YYYY-MM-DD` */
  day: string;
  /** 该本地日 00:00 的毫秒时间戳（宿主本地时区），可直接用于排序或格式化 */
  dayStart: number;
  plays: number;
  totalMs: number;
}

export interface ListeningStats {
  /** 总播放时长（ms）：全部有效条目之和（含缺 id 的条目） */
  totalMs: number;
  /** 总播放次数：有效条目数（含缺 id / 缺时长的条目） */
  totalPlays: number;
  /** 其中 `interval` 缺失/非法的条目数（这些条目对 totalMs 贡献 0） */
  playsWithoutDuration: number;
  /** Top 歌曲完整排名（次数降序 → 时长降序 → key 升序） */
  topTracks: ListeningStatsTrack[];
  /** Top 歌手完整排名（次数降序 → 时长降序 → 名称升序） */
  topArtists: ListeningStatsArtist[];
  /** 按天趋势，按 `dayStart` 升序；只含数据里出现过的天 */
  byDay: ListeningStatsDay[];
}

/** 是否是「带时间戳的条目」方言（移动端 `entries` 的形状）。 */
function isPlayEntry(item: ListeningStatsInput): item is HistoryPlayEntry {
  return "song" in item;
}

/**
 * 把一条原始条目归一成 `{ song, playedAt }`：
 * - `{ song }` 方言（移动端 `entries`）取 `song`，`playedAt` 走合法性收敛；
 * - `MusicInfo` 方言（桌面 history，没有时间戳字段）取条目自身，`playedAt` 恒为 `null`；
 * - 非对象 / `song` 不是对象 → `null`（损坏条目，跳过，不参与任何统计）。
 * 这里只校验「是个对象」，字段缺失/类型不对由各字段自己的解析函数兜底。
 */
function resolveEntry(item: ListeningStatsInput | null | undefined): ResolvedHistoryEntry | null {
  if (typeof item !== "object" || item === null) return null;
  if (!isPlayEntry(item)) return { song: item, playedAt: null };
  if (typeof item.song !== "object" || item.song === null) return null;
  return { song: item.song, playedAt: toPositiveTimestamp(item.playedAt) };
}

/** 合法播放时间戳：有限且 > 0 的毫秒值；其余（`undefined` / `NaN` / 0 / 负数 / 字符串 / `Infinity`）视为没有。 */
function toPositiveTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** 归一后的一条历史记录：歌曲本体 + 可用时间戳（`null` = 没有 / 不可用）。 */
interface ResolvedHistoryEntry {
  song: MusicInfo;
  playedAt: number | null;
}

/**
 * `MusicInfo.interval`（秒）换算成毫秒并做合法性收敛：
 * 缺失 / 非数字 / `NaN` / `Infinity` / `<= 0` → `null`（调用方按 0 ms 计）。
 */
function toIntervalMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1000);
}

/** 去重键 `${source}:${id}`；`id` 缺失或全空白 → `null`（该条不进歌曲榜）。 */
function toTrackKey(song: MusicInfo): string | null {
  const id = typeof song.id === "string" ? song.id.trim() : "";
  if (id.length === 0) return null;
  const source = typeof song.source === "string" ? song.source.trim() : "";
  return `${source}:${id}`;
}

/** 歌手名：非字符串 / 全空白 → `null`（该条不进歌手榜）。 */
function toArtistName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 ? name : null;
}

/** 本地日历日的起点（本地 00:00 的毫秒时间戳），与移动端 `dayStartOf` 同口径。 */
function localDayStart(timestampMs: number): number {
  const date = new Date(timestampMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 本地日历日字符串 `YYYY-MM-DD`，与移动端 `toDateText` 同格式。 */
function localDayKey(dayStartMs: number): string {
  const date = new Date(dayStartMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 榜单排序：次数降序 → 时长降序 → 兜底键码位升序。 */
function compareRanking(
  a: { plays: number; totalMs: number },
  b: { plays: number; totalMs: number },
  aTieBreak: string,
  bTieBreak: string,
): number {
  if (a.plays !== b.plays) return b.plays - a.plays;
  if (a.totalMs !== b.totalMs) return b.totalMs - a.totalMs;
  if (aTieBreak === bTieBreak) return 0;
  return aTieBreak < bTieBreak ? -1 : 1;
}

/**
 * 聚合播放历史。
 *
 * 详见文件顶部契约：播放次数 = 条目数，时长 = `MusicInfo.interval`（秒）× 1000，按天按宿主本地日历日切分。
 */
export function aggregateListeningStats(
  entries: readonly (ListeningStatsInput | null | undefined)[] | null | undefined,
): ListeningStats {
  const tracks = new Map<string, ListeningStatsTrack>();
  const artists = new Map<string, ListeningStatsArtist>();
  const days = new Map<number, ListeningStatsDay>();
  let totalMs = 0;
  let totalPlays = 0;
  let playsWithoutDuration = 0;

  if (entries) {
    for (const item of entries) {
      const resolved = resolveEntry(item);
      if (!resolved) continue;
      const { song, playedAt } = resolved;
      const intervalMs = toIntervalMs(song.interval);
      const entryMs = intervalMs ?? 0;
      totalPlays += 1;
      totalMs += entryMs;
      if (intervalMs === null) playsWithoutDuration += 1;

      const key = toTrackKey(song);
      if (key !== null) {
        const track = tracks.get(key);
        if (track) {
          track.plays += 1;
          track.totalMs += entryMs;
        } else {
          tracks.set(key, { key, song, plays: 1, totalMs: entryMs });
        }
      }

      const artistName = toArtistName(song.singer);
      if (artistName !== null) {
        const artist = artists.get(artistName);
        if (artist) {
          artist.plays += 1;
          artist.totalMs += entryMs;
        } else {
          artists.set(artistName, { name: artistName, plays: 1, totalMs: entryMs });
        }
      }

      if (playedAt !== null) {
        const dayStart = localDayStart(playedAt);
        const day = days.get(dayStart);
        if (day) {
          day.plays += 1;
          day.totalMs += entryMs;
        } else {
          days.set(dayStart, { day: localDayKey(dayStart), dayStart, plays: 1, totalMs: entryMs });
        }
      }
    }
  }

  return {
    totalMs,
    totalPlays,
    playsWithoutDuration,
    topTracks: [...tracks.values()].sort((a, b) => compareRanking(a, b, a.key, b.key)),
    topArtists: [...artists.values()].sort((a, b) => compareRanking(a, b, a.name, b.name)),
    byDay: [...days.values()].sort((a, b) => a.dayStart - b.dayStart),
  };
}
