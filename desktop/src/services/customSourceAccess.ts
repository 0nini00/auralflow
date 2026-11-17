import type { PlaybackBackendId } from "@/services/playback/types";

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
    /** 「现在允许访问 LX 吗」的唯一判定；需要先等持久化恢复的调用方走 customSourceGate。 */
    isEnabled,
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

/** 经 LX 脚本运行时取链的后端。隐藏兜底同样跑 LX 脚本，生命周期判定与普通自定义源一致。 */
export type CustomSourceRuntimeBackend = Extract<PlaybackBackendId, "customSource" | "hiddenSource">;

export function usesCustomSourceRuntime(
  backend: PlaybackBackendId | undefined,
): backend is CustomSourceRuntimeBackend {
  return backend === "customSource" || backend === "hiddenSource";
}

/**
 * 「拿到了 LX 结果」时的强制检查：必须持有仍然有效的令牌，否则抛 CustomSourceDisabledError。
 * 非 LX 结果不受功能开关约束，返回 undefined（调用方据此决定后续要不要继续校验）。
 *
 * 没有令牌 = 本次操作开始时功能没开（中途才打开，或调用方漏传）。它与「令牌已失效」
 * 同属「这个结果不归本次操作所有」，统一成同一种错误类型（此前缓存层对它抛普通 Error，
 * 播放链路抛 CustomSourceDisabledError，同一件事两种类型），文案上点明是缺令牌。
 */
export function requireCustomSourceOperation(
  backend: PlaybackBackendId | undefined,
  operation: CustomSourceOperation | undefined,
): CustomSourceOperation | undefined {
  if (!usesCustomSourceRuntime(backend)) return undefined;
  if (!operation) throw new CustomSourceDisabledError("LX 结果缺少操作令牌：本次操作开始时 LX 自定义音源未启用，结果不能使用");
  operation.assertActive();
  return operation;
}

/** 「能不能复用一条已有结果」的宽松检查：LX 结果只在令牌仍有效时可用，不抛错，交给调用方跳过。 */
export function canReuseCustomSourceResult(
  backend: PlaybackBackendId | undefined,
  operation: CustomSourceOperation | undefined,
): boolean {
  return !usesCustomSourceRuntime(backend) || operation?.isActive() === true;
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
