import { throwIfAborted, waitWithSignal } from './cancellation';

interface SharedRequest<T> {
  controller: AbortController;
  promise: Promise<T>;
  consumers: number;
  settled: boolean;
}

/** 同键共享生产者；消费者取消等待，最后一位退出才取消实际网络。 */
export function createSharedRequestPool<T>() {
  const requests = new Map<string, SharedRequest<T>>();
  return {
    async run(key: string, start: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
      throwIfAborted(signal);
      let request = requests.get(key);
      if (!request) {
        const controller = new AbortController();
        const promise = start(controller.signal);
        const created: SharedRequest<T> = { controller, consumers: 0, settled: false, promise };
        requests.set(key, created);
        created.promise = promise.finally(() => {
          created.settled = true;
          if (requests.get(key) === created) requests.delete(key);
        });
        request = created;
      }
      request.consumers++;
      try {
        return await waitWithSignal(request.promise, signal);
      } finally {
        request.consumers--;
        if (request.consumers === 0 && !request.settled) {
          request.controller.abort();
          if (requests.get(key) === request) requests.delete(key);
        }
      }
    },
    /** 缓存换代让新调用独立；已有消费者继续按各自的生命周期结算。 */
    clear() { requests.clear(); },
  };
}
