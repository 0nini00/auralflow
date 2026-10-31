/**
 * 「懒切」解析编排的共享预算（桌面 playbackResolver 与移动 playerService 各跑一份，
 * 数值必须一致，否则两端切歌手感和日志对不上——此前靠注释「对齐桌面端」维持，已漂移过）。
 */

/** 主源先行预算：内置网关/官方直连先单独跑，超时或音质不足才唤醒自定义源。 */
export const PRIMARY_BUDGET_MS = 2500;

/** 自定义源阶段单次预算：覆盖队尾慢源展开 + 服务端 2-10s 慢回退。 */
export const CUSTOM_SOURCE_RESOLVE_BUDGET_MS = 10_000;

/** 交错启动总展开上限：源/档位再多也不把队尾候选推到预算尾巴。 */
export const CUSTOM_SOURCE_SPREAD_MS = 1_600;

/** 同时在途的自定义源取链请求上限（对第三方公益代理限流保护）。 */
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
