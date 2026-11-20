export function cancellationError(): Error {
  const error = new Error("请求已取消");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError();
}

/** 取消等待不转移任务所有权；共享预读的生产者持有自己的 signal。 */
export function waitWithSignal<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancellationError());
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** 子任务结束时同时取消尚未结算的分支，并拆除父监听和期限计时器。 */
export function createCancellationScope(parent?: AbortSignal, timeoutMs?: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(abort, Math.max(0, timeoutMs));
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
      abort();
    },
  };
}
