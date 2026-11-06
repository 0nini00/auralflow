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
