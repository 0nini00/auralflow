import type { MusicInfo } from "../sources";

/**
 * 收听统计的结果形状 —— 由 `stats/listening-session.ts` 的 `aggregateListeningEvents` 产出。
 *
 * 口径（不要按「历史条目数」理解）：
 * - `plays`：独立收听会话数。同一会话的多次 checkpoint 按 `sessionId` 去重，
 *   暂停恢复沿用原会话，显式 seek 只换测量起点不算新会话。
 * - `totalMs`：实测收听时长。只累计前台连续推进的时间，跳转 / 暂停 / 缓冲不计入。
 * - `playsWithoutDuration`：保留字段。事件模型里每条都带 `listenedMs`，恒为 0。
 * - `byDay`：按**宿主本地日历日**切分；事件时间未知的条目不会出现（当前模型不会产生）。
 */
export interface ListeningStats {
  /** 总收听时长（ms） */
  totalMs: number;
  /** 总收听会话数 */
  totalPlays: number;
  /** 时长未知的条目数；事件模型下恒为 0 */
  playsWithoutDuration: number;
  /** Top 歌曲完整排名（时长降序 → 次数降序 → key 升序） */
  topTracks: ListeningStatsTrack[];
  /** Top 歌手完整排名（时长降序 → 次数降序 → 名称升序） */
  topArtists: ListeningStatsArtist[];
  /** 按天趋势，按 `dayStart` 升序；只含数据里出现过的天 */
  byDay: ListeningStatsDay[];
}

/** 榜单歌曲：去重键 + 代表快照 + 该曲在本次输入里的聚合值。 */
export interface ListeningStatsTrack {
  /** 去重键 `${source}:${id}`，与两端 historyStore 的键一致 */
  key: string;
  /** 代表快照：首次出现那条记录里的 `MusicInfo`，直接引用不复制 */
  song: MusicInfo;
  /** 独立收听会话数 */
  plays: number;
  /** 累计收听时长（ms） */
  totalMs: number;
}

export interface ListeningStatsArtist {
  /** 歌手名，`MusicInfo.singer` 去掉首尾空白后的原样值；「A/B」整体作为一个单位 */
  name: string;
  /** 独立收听会话数 */
  plays: number;
  /** 累计收听时长（ms） */
  totalMs: number;
}

export interface ListeningStatsDay {
  /** 本地日历日，格式 `YYYY-MM-DD` */
  day: string;
  /** 该本地日 00:00 的毫秒时间戳（宿主本地时区），可直接用于排序或格式化 */
  dayStart: number;
  /** 当日独立收听会话数 */
  plays: number;
  /** 当日累计收听时长（ms） */
  totalMs: number;
}

/** 移动端历史条目的字段子集（`HistoryEntry`，`apps/mobile/src/services/historyGroupModel.ts:9-15`）。 */
export interface HistoryPlayEntry {
  song: MusicInfo;
  /** 播放时间戳（毫秒） */
  playedAt?: number;
}
