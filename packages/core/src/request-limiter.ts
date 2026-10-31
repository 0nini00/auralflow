/**
 * 远程请求闸门：把同时在途的请求数压到上限，超出的排队。
 *
 * 播放取链是「源 × 音质」二维展开，8 个源 × 4 档最坏会同时打出 30 个请求。
 * 对自建源无所谓，但这类源里常有第三方公益代理，被限流之后所有源一起变慢，
 * 竞速反而退化成「一起超时」。压到 3 个之后最坏请求量从乘积变回接近线性。
 *
 * 两个必需的逃生口：
 *  - **租约**：请求迟迟不返回时主动让位。只靠「settle 才释放」会被挂死的源
 *    把槽位永久占住——实测场景是前排 2 个源各挂 60s，队尾唯一可用的源永远
 *    排不上队，比不限流还糟。租约到期后请求本身继续跑（仍可能返回结果），
 *    只是不再计入并发。
 *  - **排队超时**：宁可多打一个请求，也不让队尾饿死。
 *
 * 两者之外的候选一旦所在轮次定稿（`abandon`），立即作废、一个请求都不发，
 * 否则排队中的候选会在「用户已经在听了」之后继续补发。
 */

/** 槽位租约：超过这个时长仍未 settle 的请求让出槽位。 */
export const DEFAULT_REQUEST_LEASE_MS = 2_500;

/** 排队等待上限：超过就直接放行（不占槽）。 */
export const DEFAULT_REQUEST_QUEUE_WAIT_MS = 800;

export interface RequestLimiterOptions {
  /** 同时在途的请求上限。 */
  limit: number;
  /** 槽位租约时长，默认 {@link DEFAULT_REQUEST_LEASE_MS}。 */
  leaseMs?: number;
  /** 排队等待上限，默认 {@link DEFAULT_REQUEST_QUEUE_WAIT_MS}。 */
  queueWaitMs?: number;
}

export interface RequestLimiter {
  /**
   * 申请一个执行名额。拿到（或排队溢出放行）后返回释放函数，必须调用；
   * 本轮已 `abandon` 时直接抛错，调用方不应再发请求。
   */
  acquire(): Promise<() => void>;
  /** 本轮结束：排队中的候选全部作废。 */
  abandon(): void;
}

export function createRequestLimiter(options: RequestLimiterOptions): RequestLimiter {
  const limit = Math.max(1, Math.floor(options.limit));
  const leaseMs = options.leaseMs ?? DEFAULT_REQUEST_LEASE_MS;
  const queueWaitMs = options.queueWaitMs ?? DEFAULT_REQUEST_QUEUE_WAIT_MS;

  let active = 0;
  let abandoned = false;
  const waiters: Array<() => void> = [];

  /** 让出一个槽位；有排队者时直接转交（+1 与唤醒原子完成，避免多放一个进并发）。 */
  const releaseSlot = () => {
    if (active > 0) active -= 1;
    if (abandoned) return;
    const next = waiters.shift();
    if (next) {
      active += 1;
      next();
    }
  };

  return {
    async acquire(): Promise<() => void> {
      if (abandoned) throw new Error('当前解析轮次已结束，排队中的候选被放弃');

      if (active >= limit) {
        const admitted = await new Promise<boolean>((resolve) => {
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | null = null;
          const waiter = () => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(!abandoned);
          };
          waiters.push(waiter);
          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            resolve(false);
          }, queueWaitMs);
        });
        if (abandoned) throw new Error('当前解析轮次已结束，排队中的候选被放弃');
        if (!admitted) {
          // 排队溢出：前几个槽位大概已经挂死。放行但不占槽，返回 no-op
          // 释放函数，否则会把别人刚转交进来的槽位吃掉。
          return () => {};
        }
      } else {
        active += 1;
      }

      let released = false;
      const lease = setTimeout(() => {
        if (released) return;
        released = true;
        releaseSlot();
      }, leaseMs);
      return () => {
        if (released) return;
        released = true;
        clearTimeout(lease);
        releaseSlot();
      };
    },
    abandon(): void {
      abandoned = true;
      // 排队中的 waiter 被拒绝时，其中已 admit 但尚未恢复执行的 acquire 会在
      // 恢复后直接抛错、拿不到释放函数——实例已废弃，把计数清零即可，不欠释放。
      active = 0;
      for (const waiter of waiters.splice(0)) waiter();
    },
  };
}
