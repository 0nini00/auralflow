export { normalizeWyCookie } from "@lx/core";

/**
 * 从 Cookie 提取 csrf_token（weapi 请求的必带字段）。
 *
 * 正则需同时匹配 `__csrf` 与 `__csrf_token` 两种键名：登录校验与后续 weapi
 * 请求必须提取出同一个值——此前 wyAccountService 与 wyPlaylistService 各持
 * 一份正则且宽窄不一（窄版匹配不到 `__csrf_token`），同一份 Cookie 两处会
 * 提取出不同的 csrf，已收敛为这一份。
 */
export function extractWyCsrfToken(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)__?csrf(?:_token)?=([^;]+)/);
  return match?.[1] ?? "";
}
