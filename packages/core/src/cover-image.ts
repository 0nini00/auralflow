/**
 * 封面缩略图 URL —— 双端共用。
 *
 * 各图床返回的默认封面是原图（网易云常见 1000x1000 以上，实测有 4MB 的样本），
 * 列表里几十个 item 同时拉原图会明显拖慢首屏与滚动。这里按显示尺寸改写 URL，
 * 让图床直接返回缩略图。
 *
 * 只处理已知支持尺寸参数的图床；未知图床原样返回，不做猜测。
 */

/** 列表缩略图边长（px）。按 2-3x 屏下 60-80pt 的封面取值。 */
export const COVER_SIZE_THUMB = 200;
/** 播放器 / 详情页大图边长（px）。 */
export const COVER_SIZE_LARGE = 500;

const NETEASE_IMAGE_HOSTS = ["music.126.net", "126.net"];
const BILI_IMAGE_HOSTS = ["hdslb.com", "biliimg.com"];

function matchesHost(host: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * 按目标边长改写封面 URL。
 *
 * - 网易云：追加 `?param=WxH`（已带 param 时保持原样，尊重调用方显式指定）
 * - B站：追加 `@WwHh.webp` 后缀（已带 `@` 处理参数时保持原样）
 * - 其他图床：原样返回
 *
 * 用字符串拼接而非改写 URL 对象属性：RN 的 URL 类型把 pathname 标为只读，
 * 且 polyfill 对 searchParams 的可变性支持不完整。
 */
export function resizeCoverUrl(rawUrl: string | null | undefined, size: number): string {
  const value = rawUrl?.trim() ?? "";
  if (!value || size <= 0) return value;
  // 本地文件与 data URL 不做处理
  if (!/^https?:\/\//i.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  const host = url.hostname.toLowerCase();
  const [beforeHash, ...hashParts] = value.split("#");
  const hash = hashParts.length ? `#${hashParts.join("#")}` : "";

  if (matchesHost(host, NETEASE_IMAGE_HOSTS)) {
    if (/[?&]param=/.test(beforeHash)) return value;
    const separator = beforeHash.includes("?") ? "&" : "?";
    return `${beforeHash}${separator}param=${size}y${size}${hash}`;
  }

  if (matchesHost(host, BILI_IMAGE_HOSTS)) {
    if (url.pathname.includes("@")) return value;
    const queryIndex = beforeHash.indexOf("?");
    const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
    const search = queryIndex >= 0 ? beforeHash.slice(queryIndex) : "";
    return `${path}@${size}w_${size}h.webp${search}${hash}`;
  }

  return value;
}
