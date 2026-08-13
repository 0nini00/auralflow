/**
 * 带超时的 fetch 封装。
 *
 * 移动端所有网络请求都应经由本函数发出，避免弱网/断网时请求长期挂起
 * （Promise 永不 resolve 会让播放 loading、首页转圈、WebDAV 同步假死）。
 *
 * 超时通过 AbortController 中断，调用方 catch 到 AbortError 后可自行判断重试策略。
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/** fetch 期望的 signal 类型（lib.dom 的 AbortSignal），与 RN polyfill 的全局声明区分开 */
type FetchSignal = NonNullable<Parameters<typeof fetch>[1]>["signal"];

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      // RN 的 AbortController polyfill 类型与 lib.dom 的 AbortSignal 存在全局声明冲突
      // （onabort 签名不同），这里显式桥接断言到 fetch 期望的类型；运行时无任何转换。
      signal: controller.signal as unknown as FetchSignal,
    });
  } finally {
    clearTimeout(timer);
  }
}
