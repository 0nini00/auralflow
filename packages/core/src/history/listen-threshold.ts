export interface ListenTrackerOptions {
  /** 歌曲总时长（秒） */
  durationSeconds: number;
  /** 绝对播放时长阈值（秒），默认 120 */
  minSeconds?: number;
  /** 相对比例阈值（0~1），默认 0.5 */
  ratio?: number;
}

export interface ListenTracker {
  /**
   * 累加一次播放步进。
   * 仅在 isPlaying 为 true 且 deltaSeconds 落在 (0, 2) 的连续区间时累加，
   * 排除拖动进度条、seek 或暂停期间的虚假推进（对齐 LX 连续性判定）。
   */
  accumulate(deltaSeconds: number, isPlaying: boolean): void;

  /** 是否已达到入历史 / 打点阈值 */
  shouldRecord(): boolean;

  /** 是否已经被记录过 */
  isRecorded(): boolean;

  /** 手动标记已记录 */
  markRecorded(): void;

  /**
   * 原子检查并标记：若达到条件且尚未记录，返回 true 并立即标记已记录；
   * 后续调用即使持续达到阈值也返回 false，保证同一曲单次会话只触发一次。
   */
  checkAndRecord(): boolean;

  /** 获取当前已有效累加的秒数 */
  getAccumulated(): number;

  /** 重置累加器（切歌或重新播放时） */
  reset(): void;
}

export const DEFAULT_LISTEN_THRESHOLD_MIN_SECONDS = 120;
export const DEFAULT_LISTEN_THRESHOLD_RATIO = 0.5;

/**
 * 创建听歌时长/比例追踪器。
 *
 * 满足任一条件即判定为已收听（对齐 LX-N 的 2 分钟或 50% 判定）：
 * 1. 累积播放时长 >= minSeconds (120s)
 * 2. 歌曲时长 > 0 且 累积播放时长 >= durationSeconds * ratio (50%)
 */
export function createListenTracker(options: ListenTrackerOptions): ListenTracker {
  const minSeconds = options.minSeconds ?? DEFAULT_LISTEN_THRESHOLD_MIN_SECONDS;
  const ratio = options.ratio ?? DEFAULT_LISTEN_THRESHOLD_RATIO;
  const duration = Number.isFinite(options.durationSeconds) && options.durationSeconds > 0
    ? options.durationSeconds
    : 0;

  let accumulated = 0;
  let recorded = false;

  return {
    accumulate(deltaSeconds: number, isPlaying: boolean): void {
      if (!isPlaying) return;
      // 连续播放才计入，允许 (0, 2) 的步进；seek、跳跃或反向不计
      if (deltaSeconds <= 0 || deltaSeconds >= 2) return;
      accumulated += deltaSeconds;
    },

    shouldRecord(): boolean {
      if (accumulated >= minSeconds) return true;
      if (duration > 0 && accumulated >= duration * ratio) return true;
      return false;
    },

    isRecorded(): boolean {
      return recorded;
    },

    markRecorded(): void {
      recorded = true;
    },

    checkAndRecord(): boolean {
      if (recorded) return false;
      if (this.shouldRecord()) {
        recorded = true;
        return true;
      }
      return false;
    },

    getAccumulated(): number {
      return accumulated;
    },

    reset(): void {
      accumulated = 0;
      recorded = false;
    },
  };
}
