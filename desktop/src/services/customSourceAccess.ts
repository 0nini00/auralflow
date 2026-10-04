/** 功能生命周期：布尔状态由 store 注入，这里只管理操作失效，不另存开关。 */
export interface CustomSourceOperation {
  readonly signal: AbortSignal;
  isActive(): boolean;
  assertActive(): void;
}

export class CustomSourceDisabledError extends Error {
  constructor(message = "LX 自定义音源未启用，或当前操作已因开关变化而取消") {
    super(message);
    this.name = "CustomSourceDisabledError";
  }
}

export function createCustomSourceAccess(isEnabled: () => boolean) {
  let version = 0;
  let controller = new AbortController();
  return {
    get version() { return version; },
    invalidate() {
      version += 1;
      controller.abort();
      controller = new AbortController();
    },
    capture(): CustomSourceOperation {
      const signal = controller.signal;
      const capturedVersion = version;
      const isActive = () => !signal.aborted && capturedVersion === version && isEnabled();
      const assertActive = () => {
        if (!isActive()) throw new CustomSourceDisabledError();
      };
      assertActive();
      return { signal, isActive, assertActive };
    },
  };
}

/** 只能终止应用侧等待，不能撤回已交给原生层的网络请求。 */
export function awaitCustomSourceOperation<T>(operation: CustomSourceOperation, task: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => operation.signal.removeEventListener('abort', onAbort);
    const onAbort = () => { cleanup(); reject(new CustomSourceDisabledError()); };
    operation.signal.addEventListener('abort', onAbort, { once: true });
    task.then((value) => {
      cleanup();
      if (!operation.isActive()) { reject(new CustomSourceDisabledError()); return; }
      resolve(value);
    }, (error) => {
      cleanup();
      reject(operation.isActive() ? error : new CustomSourceDisabledError());
    });
    if (!operation.isActive()) onAbort();
  });
}
