/** 后台服务唯一持有失败处置；store 只通过健康播放信号归还额度。 */
export type PlaybackFailureAction = "retry" | "skip";
export const MAX_CONSECUTIVE_AUTO_SKIPS = 3;

export function normalizeAutoSkipOnPlaybackError(value: unknown): boolean {
  return value === true;
}

const retryConsumedKeys = new Set<string>();
let consecutiveAutoSkips = 0;

/** 每首歌在证明健康前仅允许一次原生错误重解析。 */
export function decidePlaybackFailureAction(songKey: string): PlaybackFailureAction {
  if (retryConsumedKeys.has(songKey)) return "skip";
  retryConsumedKeys.add(songKey);
  return "retry";
}

export function hasReachedAutoSkipLimit(): boolean {
  return consecutiveAutoSkips >= MAX_CONSECUTIVE_AUTO_SKIPS;
}

/** 只有确实换到另一首歌才消耗跳过额度，包括新歌解析失败的情况。 */
export function noteAutomaticSkip(): void {
  consecutiveAutoSkips += 1;
}

/** play() 返回不代表健康；仅由 store 检测到播放位置推进后调用。 */
export function notePlaybackHealthy(songKey: string): void {
  retryConsumedKeys.delete(songKey);
  consecutiveAutoSkips = 0;
}

/** 手动新意图或服务销毁结束旧失败链。 */
export function resetPlaybackFailures(): void {
  retryConsumedKeys.clear();
  consecutiveAutoSkips = 0;
}
