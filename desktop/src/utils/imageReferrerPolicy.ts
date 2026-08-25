import { COVER_SIZE_THUMB, resizeCoverUrl } from "@lx/core";

const BILI_IMAGE_HOSTS = ["biliimg.com", "hdslb.com"];

function isBiliImageHost(host: string): boolean {
  return BILI_IMAGE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * 归一化图片地址：补协议、B站图床升 https。
 *
 * 这是**数据层**用法（写进 store / 传给缓存），不改写尺寸，避免把缩略图 URL
 * 当成原图存下来。显示时请改用 `toCoverSrc`。
 */
export function normalizeImageUrl(src?: string | null): string {
  const value = src?.trim() ?? "";
  if (!value) return "";

  const normalized = value.startsWith("//") ? `https:${value}` : value;
  try {
    const url = new URL(normalized);
    if (isBiliImageHost(url.hostname) && url.protocol === "http:") {
      url.protocol = "https:";
    }
    return url.toString();
  } catch {
    return normalized;
  }
}

/**
 * **显示层**图片地址：在归一化基础上按显示尺寸向图床索取缩略图。
 *
 * 图床原图常有数 MB，列表直接拉原图会拖慢首屏。本地 asset 路径不受影响
 * （resizeCoverUrl 只处理 http(s)）。
 */
export function toCoverSrc(src?: string | null, size: number = COVER_SIZE_THUMB): string {
  return resizeCoverUrl(normalizeImageUrl(src), size);
}

export function getImageReferrerPolicy(src?: string | null): ReferrerPolicy | undefined {
  if (!src) return undefined;
  try {
    const host = new URL(normalizeImageUrl(src), "https://placeholder.local").hostname;
    return isBiliImageHost(host) ? "no-referrer" : undefined;
  } catch {
    return undefined;
  }
}
