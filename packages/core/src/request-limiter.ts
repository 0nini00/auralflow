/**
 * 远程请求闸门：把同时在途的请求数压到上限，超出的排队。
 *
 * 播放取链按「源 × 音质」展开。限制同时在途数量，避免大量候选一起请求代理。
 * 这不会减少最坏候选总数；候选顺序与总截止时间由调用方决定。
 *
 * 只在调用方确认任务结算后归还名额；取消排队不会取消持有名额的任务。
 * 调用方负责请求级超时和取消，不能靠删除计数让仍在运行的请求「隐身」。
 * 本轮定稿（`abandon`）立即拒绝剩余排队者，避免播放后继续补发候选。
 */

export interface RequestLimiterOptions {
  /** 同时在途的请求上限。 */
  limit: number;
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

  let active = 0;
  let abandoned = false;
  const waiters: Array<(() => void) & { priority: number }> = [];

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
    async acquire(signal?: AbortSignal, priority = 0): Promise<() => void> {
      const abortError = () => Object.assign(new Error('请求已取消'), { name: 'AbortError' });
      if (signal?.aborted) throw abortError();
      if (abandoned) throw new Error('当前解析轮次已结束，排队中的候选被放弃');

      if (active >= limit) {
        const admitted = await new Promise<boolean>((resolve, reject) => {
          let settled = false;
          const waiter = Object.assign(() => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            resolve(!abandoned);
          }, { priority });
          const abort = () => {
            if (settled) return;
            settled = true;
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            signal?.removeEventListener('abort', abort);
            reject(abortError());
          };
          waiters.push(waiter);
          waiters.sort((a, b) => a.priority - b.priority);
          signal?.addEventListener('abort', abort, { once: true });
        });
        if (abandoned) throw new Error('当前解析轮次已结束，排队中的候选被放弃');
        if (signal?.aborted) {
          if (admitted) releaseSlot();
          throw abortError();
        }
      } else {
        active += 1;
      }

      let released = false;
      return () => {
        if (released) return;
        released = true;
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
