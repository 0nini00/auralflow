export function cancellationError(): Error {
  return Object.assign(new Error('播放请求已取消'), { name: 'AbortError' });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError();
}

/** 只取消消费者的等待；共享任务由生产者自己的 signal 决定是否终止。 */
export function waitWithSignal<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancellationError());
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createCancellationScope(parent?: AbortSignal, timeoutMs?: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(abort, Math.max(0, timeoutMs));
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
      abort();
    },
  };
}
