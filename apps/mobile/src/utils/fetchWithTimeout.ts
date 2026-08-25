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
  // credentials 默认 "omit"：RN Android 在 withCredentials 为真时保留 OkHttp 的
  // ReactCookieJarContainer（NetworkingModule.kt: `if (!withCredentials) cookieJar(NO_COOKIES)`），
  // 而 OkHttp BridgeInterceptor 一旦从 CookieJar 取到非空 cookie，就会用
  // requestBuilder.header("Cookie", ...) 整体替换掉调用方手动设置的 Cookie 头。
  // 于是访问过 music.163.com 后系统 CookieJar 里的匿名 cookie 会顶掉 MUSIC_U，
  // 服务器按匿名会话响应（code=200 但 account 为空）。本项目所有需要 cookie 的请求
  // （网易云 / B站 / QQ）都显式传 Cookie 头，不依赖 CookieJar，禁用它才是正确语义。
  const { credentials, ...rest } = init ?? {};
  try {
    return await fetch(url, {
      ...rest,
      credentials: credentials ?? "omit",
      // RN 的 AbortController polyfill 类型与 lib.dom 的 AbortSignal 存在全局声明冲突
      // （onabort 签名不同），这里显式桥接断言到 fetch 期望的类型；运行时无任何转换。
      signal: controller.signal as unknown as FetchSignal,
    });
  } finally {
    clearTimeout(timer);
  }
}
