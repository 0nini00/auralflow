import { createRequestLimiter, MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS } from '@lx/core';
import { createCancellationScope, throwIfAborted } from './cancellation';

const CONTENDED_REQUEST_TIMEOUT_MS = 3500;

/** 有竞争才取消最早的必要持有者；真实任务退出后才转交名额。 */
export function createPlaybackRequestScheduler() {
  const holders = new Set<(contended: boolean) => void>();
  let waiting = 0;
  const update = () => {
    let index = 0;
    for (const holder of holders) holder(index++ < waiting);
  };
  const limiter = createRequestLimiter({
    limit: MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS,
    onQueueChange(count) { waiting = count; update(); },
  });
  return {
    async run<T>(task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, priority = 0): Promise<T> {
      const release = await limiter.acquire(signal, priority);
      const scope = createCancellationScope(signal);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onContention = (contended: boolean) => {
        if (!contended) { clearTimeout(timer); timer = undefined; }
        else if (timer === undefined) timer = setTimeout(() => scope.dispose(), CONTENDED_REQUEST_TIMEOUT_MS);
      };
      holders.add(onContention);
      update();
      try {
        throwIfAborted(scope.signal);
        return await task(scope.signal);
      } finally {
        holders.delete(onContention);
        clearTimeout(timer);
        scope.dispose();
        release();
      }
    },
  };
}
