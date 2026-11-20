import { CUSTOM_SOURCE_ATTEMPT_TIMEOUT_MS, MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS } from "./playback-budgets";
import { createRequestLimiter } from "./request-limiter";

/** 候选得到名额后拥有固定窗口；其他候选排队不会缩短它的期限。 */
export function createPlaybackRequestScheduler(options: {
  limit?: number;
  attemptTimeoutMs?: number;
} = {}) {
  const limiter = createRequestLimiter({ limit: options.limit ?? MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS });
  const timeoutMs = options.attemptTimeoutMs ?? CUSTOM_SOURCE_ATTEMPT_TIMEOUT_MS;
  return {
    async run<T>(task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, priority = 0): Promise<T> {
      const release = await limiter.acquire(signal, priority);
      const controller = new AbortController();
      let failure: Error | undefined;
      const cancel = (error: Error) => {
        if (controller.signal.aborted) return;
        failure = error;
        controller.abort();
      };
      const abort = () => cancel(Object.assign(new Error("播放请求已取消"), { name: "AbortError" }));
      const timer = setTimeout(() => cancel(Object.assign(
        new Error(`音源候选超时（${timeoutMs}ms）`), { name: "TimeoutError" },
      )), timeoutMs);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      try {
        if (failure) throw failure;
        const value = await task(controller.signal);
        if (failure) throw failure;
        return value;
      } catch (error) {
        throw failure ?? error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        controller.abort();
        // 等实际任务退出再释放，取消信号本身不代表网络请求已经结束。
        release();
      }
    },
  };
}
