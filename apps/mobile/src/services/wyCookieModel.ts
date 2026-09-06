/**
 * 网易云 Cookie 归一化（对齐桌面端 normalizeWyCookie，desktop/src/services/wyAccountService.ts:74）。
 *
 * 从浏览器 DevTools/抓包工具复制的 Cookie 常见形态：
 * - 带 `Cookie:` 请求头前缀；
 * - 多行 name=value（每行一对）；
 * - 制表符分隔的表格（name\tvalue）；
 * - 复制时误选了表头 `name value`。
 *
 * 未归一化时整串被当作 Cookie 值发出，网易解析不到 MUSIC_U，一律回 301
 * 「Cookie 无效或已过期」——即使 Cookie 本身是新鲜的。
 */
export function normalizeWyCookie(input: string): string {
  return input
    .replace(/^\s*cookie\s*:\s*/i, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^name\s+value\b/i.test(line))
    .map((line) => {
      const tabParts = line.split("\t").map((part) => part.trim());
      return tabParts.length >= 2 ? `${tabParts[0]}=${tabParts[1]}` : line;
    })
    .join("; ")
    .replace(/\bCookie\s*:\s*/gi, "")
    .replace(/;{2,}/g, ";")
    .replace(/\s*;\s*/g, "; ")
    .trim();
}

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
