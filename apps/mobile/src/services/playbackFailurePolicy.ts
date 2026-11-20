/** 后台服务唯一持有自动跳过额度，候选恢复由 playerService 的剩余预算限制。 */
export const MAX_CONSECUTIVE_AUTO_SKIPS = 3;

export function normalizeAutoSkipOnPlaybackError(value: unknown): boolean {
  return value === true;
}

let consecutiveAutoSkips = 0;

export function hasReachedAutoSkipLimit(): boolean {
  return consecutiveAutoSkips >= MAX_CONSECUTIVE_AUTO_SKIPS;
}

/** 只有确实换到另一首歌才消耗跳过额度，包括新歌解析失败的情况。 */
export function noteAutomaticSkip(): void {
  consecutiveAutoSkips += 1;
}

/** play() 返回不代表健康；仅由 store 检测到播放位置推进后调用。 */
export function notePlaybackHealthy(_songKey: string): void {
  consecutiveAutoSkips = 0;
}

/** 手动新意图或服务销毁结束旧失败链。 */
export function resetPlaybackFailures(): void {
  consecutiveAutoSkips = 0;
}
