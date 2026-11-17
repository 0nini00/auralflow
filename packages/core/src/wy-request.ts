/**
 * 网易云请求的「形状」：请求头怎么拼、响应文本怎么读、哪些 code 表示登录失效。
 *
 * 只描述形状，不发请求——发请求是两端各自的事（桌面走 tauri-plugin-http，
 * 移动端走带超时的 RN fetch）。此前每个服务文件各拼一遍请求头、各写一遍
 * 「先取文本再解析」，同一个接口在不同文件里对空响应、风控页、登录失效的
 * 处理都不一样。
 */

/**
 * 网页端 UA。必须是完整的浏览器 UA：只写到 `AppleWebKit/537.36` 的残缺版本
 * 曾被风控直接拒绝（返回 301）。
 */
export const WY_WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.54";

export const WY_WEB_ORIGIN = "https://music.163.com";

/**
 * 网易云登录态失效。
 *
 * 与网络失败、业务错误区分开：账号层据此清掉已失效的 Cookie 并引导重新登录。
 * 判定必须靠这个类型而不是错误文案——文案改动或巧合的关键词都会让判定静默出错。
 */
export class WyAuthExpiredError extends Error {
  constructor(message = "网易云登录已过期，请重新登录") {
    super(message);
    this.name = "WyAuthExpiredError";
  }
}

export interface WyHttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface WyWeapiRequestInput {
  /** weapi 路径，以 `/` 开头，例如 `/user/playlist`。 */
  path: string;
  params: string;
  encSecKey: string;
  /** 已按接口需要处理好的 Cookie（是否改写成 PC 形态由调用方决定）；空串表示匿名。 */
  cookie: string;
}

/** 拼出一条 weapi POST 请求。 */
export function buildWyWeapiRequest(input: WyWeapiRequestInput): WyHttpRequest {
  if (!input.path.startsWith("/")) {
    throw new Error(`网易云 weapi 路径必须以 / 开头: ${input.path}`);
  }
  const headers: Record<string, string> = {
    "User-Agent": WY_WEB_USER_AGENT,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Origin: WY_WEB_ORIGIN,
    Referer: WY_WEB_ORIGIN,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (input.cookie) headers.Cookie = input.cookie;

  return {
    url: `${WY_WEB_ORIGIN}/weapi${input.path}`,
    method: "POST",
    headers,
    body: `params=${encodeURIComponent(input.params)}&encSecKey=${encodeURIComponent(input.encSecKey)}`,
  };
}

export interface WyResponseContext {
  /** 接口路径，只用于报错定位。 */
  path: string;
  status: number;
}

const RESPONSE_PREVIEW_LENGTH = 120;

/**
 * 把响应文本解析成对象。
 *
 * 一律先取文本再解析：被风控或登录失效时服务端返回的是空响应或 HTML 错误页，
 * 直接 `response.json()` 只会得到一条看不出原因的 SyntaxError。
 */
export function parseWyResponseText(text: string, context: WyResponseContext): Record<string, unknown> {
  const where = `${context.path}，HTTP ${context.status}`;
  if (!text.trim()) throw new Error(`网易云返回空响应（${where}）`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`网易云返回了非 JSON 响应（${where}）: ${text.slice(0, RESPONSE_PREVIEW_LENGTH)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`网易云响应不是对象（${where}）`);
  }
  return parsed as Record<string, unknown>;
}

/** 服务端明确表示「当前会话无效」的业务 code。 */
export function isWyAuthExpiredCode(code: unknown): boolean {
  return code === 301 || code === 401 || code === 403;
}
