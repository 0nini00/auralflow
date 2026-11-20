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
export const PLAYBACK_RESOLVE_TOTAL_BUDGET_MS = 30_000;

/** 候选已完成探活，尾部只给结果提交和媒体准备留余量，不再重复预留一次探活。 */
export const CUSTOM_SOURCE_PROBE_RESERVE_MS = 1_000;

/**
 * 主源耗满 PRIMARY_BUDGET_MS 后的自定义源阶段上限，包含内层探活与逐层结算。
 *
 * 最多三个请求并发时，允许八个源的首选档分三批获得固定尝试窗口。
 */
export const CUSTOM_SOURCE_PLAYBACK_WINDOW_MS =
  PLAYBACK_RESOLVE_TOTAL_BUDGET_MS - PRIMARY_BUDGET_MS - CUSTOM_SOURCE_PROBE_RESERVE_MS;

/** 自定义源整轮预算；具体候选的计时从取得并发名额开始。 */
export const CUSTOM_SOURCE_RESOLVE_BUDGET_MS = CUSTOM_SOURCE_PLAYBACK_WINDOW_MS;

/** 初始化、取链与候选探活共用固定窗口，不随启用源或音质数量缩短。 */
export const CUSTOM_SOURCE_ATTEMPT_TIMEOUT_MS = 8_000;

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
 * 竞速按「源 × 音质」展开，8 个源 × 4 档可以产生 32 个候选。
 * 并发上限只限制同时在途数量，不保证所有候选在总预算内完成。
 * 双端共用固定候选期限，只有真实请求退出后才转交名额。
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
