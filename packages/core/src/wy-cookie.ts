/** 支持请求头、多行键值和浏览器 DevTools 表格格式，供平台登录入口共用。 */
export function normalizeWyCookie(input: string): string {
  return input
    .replace(/^\s*cookie\s*:\s*/i, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^name\s+value\b/i.test(line))
    .map((line) => {
      const tabParts = line.split('\t').map((part) => part.trim());
      return tabParts.length >= 2 ? `${tabParts[0]}=${tabParts[1]}` : line;
    })
    .join('; ')
    .replace(/\bCookie\s*:\s*/gi, '')
    .replace(/;{2,}/g, ';')
    .replace(/\s*;\s*/g, '; ')
    .trim();
}

/**
 * 从 Cookie 提取 csrf_token（weapi 请求的必带字段）。
 *
 * 键名有 `__csrf`、`_csrf`、`__csrf_token` 三种写法，必须都认：登录校验与后续
 * weapi 请求要提取出同一个值。两端此前共有三份宽窄不一的正则，窄版匹配不到
 * `__csrf_token`，同一份 Cookie 会在不同接口上带出不同的 csrf。
 * 锚定在分号或开头，避免把 `x__csrf=` 这类键的尾巴误当成 csrf。
 */
export function extractWyCsrfToken(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)__?csrf(?:_token)?=([^;]+)/);
  return match?.[1] ?? "";
}

/**
 * 把 Cookie 改写成 PC 客户端形态：去掉已有的 `os=`，追加 `os=pc`。
 *
 * 收藏/订阅这类写接口要 PC 会话才生效；读接口是否改写由调用方逐个决定——
 * 例如 `personalized/playlist` 加上 `os=pc` 后返回的是 PC Web 的通用歌单。
 */
export function buildNeteasePcCookie(cookie: string): string {
  const parts = cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^os=/i.test(part));

  return [...parts, "os=pc"].join("; ");
}
