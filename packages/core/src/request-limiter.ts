/**
 * 远程请求闸门：把同时在途的请求数压到上限，超出的排队。
 *
 * 播放取链是「源 × 音质」二维展开，8 个源 × 4 档最坏会同时打出 30 个请求。
 * 对自建源无所谓，但这类源里常有第三方公益代理，被限流之后所有源一起变慢，
 * 竞速反而退化成「一起超时」。压到 3 个之后最坏请求量从乘积变回接近线性。
 *
 * 默认严格模式只在调用方确认任务结算后归还名额；取消排队不会取消持有名额的任务。
 * 调用方负责请求级超时和取消，不能靠删除计数让仍在运行的请求「隐身」。
 * `soft` 显式兼容桌面旧调度：租约和排队超时会溢出放行，不保证真实在途上限。
 * 本轮定稿（`abandon`）立即拒绝剩余排队者，避免播放后继续补发候选。
 */

/** 槽位租约：超过这个时长仍未 settle 的请求让出槽位。 */
export const DEFAULT_REQUEST_LEASE_MS = 2_500;

/** 排队等待上限：超过就直接放行（不占槽）。 */
export const DEFAULT_REQUEST_QUEUE_WAIT_MS = 800;

export interface RequestLimiterOptions {
  /** strict 保留真实在途名额；soft 仅兼容桌面旧调度，不保证真实并发上限。 */
  mode?: "strict" | "soft";
  /** 同时在途的请求上限。 */
  limit: number;
  /** 仅 soft 模式：槽位租约时长，默认 {@link DEFAULT_REQUEST_LEASE_MS}。 */
  leaseMs?: number;
  /** 仅 soft 模式：排队等待上限，默认 {@link DEFAULT_REQUEST_QUEUE_WAIT_MS}。 */
  queueWaitMs?: number;
  /** 队列长度变化通知；宿主可取消超时持有者，但必须等任务结算才释放名额。 */
  onQueueChange?: (waiting: number) => void;
}

export interface RequestLimiter {
  /**
   * 申请一个执行名额。返回释放函数，在实际任务结算后调用；priority 越小越先执行。
   * 本轮已 `abandon` 时直接抛错，调用方不应再发请求。
   */
  acquire(signal?: AbortSignal, priority?: number): Promise<() => void>;
  /** 本轮结束：排队中的候选全部作废。 */
  abandon(): void;
}

export function createRequestLimiter(options: RequestLimiterOptions): RequestLimiter {
  const limit = Math.max(1, Math.floor(options.limit));
  const leaseMs = options.leaseMs ?? DEFAULT_REQUEST_LEASE_MS;
  const queueWaitMs = options.queueWaitMs ?? DEFAULT_REQUEST_QUEUE_WAIT_MS;
  const soft = options.mode === "soft";

  let active = 0;
  let abandoned = false;
  const waiters: Array<(() => void) & { priority: number }> = [];

  /** 让出一个槽位；有排队者时直接转交（+1 与唤醒原子完成，避免多放一个进并发）。 */
  const releaseSlot = () => {
    if (active > 0) active -= 1;
    if (abandoned) return;
    const next = waiters.shift();
    options.onQueueChange?.(waiters.length);
    if (next) {
      active += 1;
      next();
    }
  };

  return {
    async acquire(signal?: AbortSignal, priority = 0): Promise<() => void> {
      const abortError = () => Object.assign(new Error('请求已取消'), { name: 'AbortError' });
      if (signal?.aborted) throw abortError();
      if (abandoned) throw new Error('当前解析轮次已结束，排队中的候选被放弃');

      if (active >= limit) {
        const admitted = await new Promise<boolean>((resolve, reject) => {
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | null = null;
          const waiter = Object.assign(() => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            resolve(!abandoned);
          }, { priority });
          const abort = () => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            options.onQueueChange?.(waiters.length);
            signal?.removeEventListener('abort', abort);
            reject(abortError());
          };
          waiters.push(waiter);
          waiters.sort((a, b) => a.priority - b.priority);
          options.onQueueChange?.(waiters.length);
          signal?.addEventListener('abort', abort, { once: true });
          if (soft) timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            options.onQueueChange?.(waiters.length);
            signal?.removeEventListener('abort', abort);
            resolve(false);
          }, queueWaitMs);
        });
        if (abandoned) throw new Error('当前解析轮次已结束，排队中的候选被放弃');
        if (signal?.aborted) {
          if (admitted) releaseSlot();
          throw abortError();
        }
        if (!admitted) {
          // 排队溢出：前几个槽位大概已经挂死。放行但不占槽，返回 no-op
          // 释放函数，否则会把别人刚转交进来的槽位吃掉。
          return () => {};
        }
      } else {
        active += 1;
      }

      let released = false;
      const lease = soft ? setTimeout(() => {
        if (released) return;
        released = true;
        releaseSlot();
      }, leaseMs) : undefined;
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
      options.onQueueChange?.(0);
    },
  };
}
