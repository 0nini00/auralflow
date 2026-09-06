/**
 * 播放失败处置策略（playerStore 与 playbackService 的唯一真相源）。
 *
 * 一次 PlaybackError 只有两种归属：先给「原地重试一次」（多数 403 靠重解析即可救回），
 * 重试额度已用掉则判为终局失败、交由后台服务跳下一首。
 *
 * 为什么需要本模块：两侧监听同一条原生事件，各自记账会得出互相矛盾的结论。
 * 实测（真机 PLR110/Android 16）每次加载失败原生只发一条 PlaybackError，
 * 由两个监听器各收一次；曾用「同一首歌累计到第 2 条事件才跳」来推断 store 是否已重试，
 * 但 store 拒绝重试时不会产生第二次加载、也就没有第二条事件，计数永远到不了阈值——
 * 表现为播放停在 ERROR 且既不重试也不跳过。故改为 store 明示结论、服务读结论。
 */

/** 本次错误的处置。 */
export type PlaybackFailureAction = "retry" | "skip";

/**
 * 终局失败后是否自动跳下一首（用户设置，默认关闭 = 停在错误态等用户处置）。
 *
 * 缺省视为 false：未显式开启即保持「失败即停」，不擅自替用户往下翻队列。
 * 注意本开关只管「重试仍失败之后」；原地重试一次不受它影响——多数 403 靠重解析
 * 即可救回，那是恢复本曲而非跳走，两种设置下都该发生。
 */
export function normalizeAutoSkipOnPlaybackError(value: unknown): boolean {
  return value === true;
}

/**
 * 已用掉重试额度的歌曲 key。
 * 额度不是会话级永久占用：歌曲一旦真正播出声即归还（见 notePlaybackHealthy），
 * 使「上次失败过的歌」重播时仍能重新获得完整的「重试一次 → 再失败才跳」链路。
 */
const retryConsumedKeys = new Set<string>();

/** 重试在途的歌曲 key：其加载期间到达的错误不得触发跳过，由该次重试自己收口。 */
let retryInFlightKey: string | null = null;

/**
 * 最近处置结论，供后台服务回读（同一条原生事件，两个监听器先后各收一次）。
 * 按歌曲 key 记账而非单槽：两条不同曲目的错误在同一微任务窗口内连发时，
 * 单槽会让第一条读到第二条的结论而误判；条目在歌曲证明可播时移除，不无界增长。
 */
const lastDecisions = new Map<string, PlaybackFailureAction>();

/**
 * 判定一条 PlaybackError 的处置，并落库结论。
 * 必须由 playerStore 的监听器同步调用，且每条事件只调用一次。
 */
export function decidePlaybackFailureAction(songKey: string): PlaybackFailureAction {
  const action: PlaybackFailureAction = retryConsumedKeys.has(songKey) ? "skip" : "retry";
  if (action === "retry") {
    retryConsumedKeys.add(songKey);
    retryInFlightKey = songKey;
  }
  lastDecisions.set(songKey, action);
  return action;
}

/** 重试收口（成败均调）：解除在途标记，此后同曲再报错即判终局。 */
export function noteRetrySettled(songKey: string): void {
  if (retryInFlightKey === songKey) retryInFlightKey = null;
}

/**
 * 本条错误是否应由后台服务跳过。
 *
 * 调用方需先让出一个微任务，确保 store 的监听器已就同一条事件落库结论，
 * 从而不依赖两个监听器的注册顺序。
 */
export function shouldAutoSkipAfterFailure(songKey: string): boolean {
  // 重试正在加载：这条错误属于重试之前的那次加载，跳过会打断在途重试
  if (retryInFlightKey === songKey) return false;
  // 结论为 retry 即已有重试接手；无结论（未经 store 判定）按跳过处理，避免卡死
  return lastDecisions.get(songKey) !== "retry";
}

/**
 * 歌曲已被证明可播（播放位置确实推进）：归还其重试额度。
 *
 * 用「位置推进」而非「play() 调用返回」作为信号——play() 只表示指令已下发，
 * 坏链要到约 3 秒后才由原生报错；位置能推进说明音频真的在解码。
 */
export function notePlaybackHealthy(songKey: string): void {
  retryConsumedKeys.delete(songKey);
  // 歌曲已在正常播放，其旧处置结论随之失效；一并移除防 Map 无界增长
  lastDecisions.delete(songKey);
}
