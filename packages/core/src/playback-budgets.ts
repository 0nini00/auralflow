/**
 * 「懒切」解析编排的共享预算（桌面 playbackResolver 与移动 playerService 各跑一份，
 * 数值必须一致，否则两端切歌手感和日志对不上——此前靠注释「对齐桌面端」维持，已漂移过）。
 */

/** 主源先行预算：内置网关/官方直连先单独跑，超时或音质不足才唤醒自定义源。 */
export const PRIMARY_BUDGET_MS = 2500;

/**
 * 播放解析总预算：竞速 + 探活 + 媒体缓存。桌面与移动共用同一个值，
 * 否则会出现「同一脚本在桌面能播、在移动端必然超时」的不对称。
 */
export const PLAYBACK_RESOLVE_TOTAL_BUDGET_MS = 14_000;

/** 给外层探活与媒体缓存预留的时间：自定义源阶段不能把总预算吃干。 */
export const CUSTOM_SOURCE_PROBE_RESERVE_MS = 6_000;

/**
 * 主源耗满 PRIMARY_BUDGET_MS 后的自定义源阶段上限，包含内层探活与逐层结算。
 *
 * 深度测试使用该上限筛除慢脚本；实际播放取链还要为子阶段结算留出时间。
 */
export const CUSTOM_SOURCE_PLAYBACK_WINDOW_MS =
  PLAYBACK_RESOLVE_TOTAL_BUDGET_MS - PRIMARY_BUDGET_MS - CUSTOM_SOURCE_PROBE_RESERVE_MS;

/** 自定义源阶段单次预算：覆盖队尾慢源展开 + 服务端 2-10s 慢回退。 */
export const CUSTOM_SOURCE_RESOLVE_BUDGET_MS = 10_000;

/** 剩余预算不足该值时不再启动新的候选尝试，避免刚启动就撞外层 deadline。 */
export const CUSTOM_SOURCE_MIN_ATTEMPT_MS = 1_000;

/** 候选地址内层探活超时：只回答「是不是死链」，不占满外层探活预算。 */
export const CANDIDATE_PROBE_TIMEOUT_MS = 2_500;

/** 子阶段先结算并把结果交给父竞速，避免同刻截止时父计时器先拒绝。 */
const RESOLVE_SETTLE_RESERVE_MS = 100;

export function getChildPlaybackDeadline(parentDeadlineAt: number): number {
  return parentDeadlineAt - RESOLVE_SETTLE_RESERVE_MS;
}

/** 交错启动总展开上限：源/档位再多也不把队尾候选推到预算尾巴（实测 7 源 × 800ms 会把队尾推到 4.8s）。 */
export const CUSTOM_SOURCE_SPREAD_MS = 1_600;

/**
 * 同时在途的自定义源取链请求上限（对第三方公益代理限流保护）。
 *
 * 竞速是「源 × 音质」二维展开，8 个源 × 4 档在最坏情况下会同时打出 30 个请求。
 * 对自建源无所谓，但这几个源里常有第三方公益代理，被限流之后所有源一起变慢，
 * 竞速反而退化成「一起超时」。压到 3 个之后最坏请求量从乘积变成接近线性，
 * 队尾候选需要排队；移动端通过请求级取消和候选时间片让位，桌面保留旧软调度。
 */
export const MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS = 3;

/**
 * 给 Promise 加预算：超时（或失败）返回 null 而不是抛错，由调用方决定是否唤醒兜底。
 * 桌面/移动此前各有一份手抄副本。
 */
export function withBudget<T>(task: Promise<T>, budgetMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), budgetMs);
    task.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}
