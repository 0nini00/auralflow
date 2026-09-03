import { assertPublicOutboundUrl } from "@lx/core";

/**
 * HTTPS 判定读原始字符串，不读 `parsed.protocol`：RN 的 `URL` 是 polyfill，
 * 安全关键字段一律不信（理由见 @lx/core/outbound-host）。这里是 WebDAV
 * 唯一的 HTTPS 强制点，判定源必须与出站校验的 scheme 判定保持一致。
 */
export function assertHttpsWebdavUrl(rawUrl: string): URL {
  if (!/^https:\/\//i.test(rawUrl.trim())) {
    throw new Error("WebDAV 服务仅支持 HTTPS 地址");
  }
  return assertPublicOutboundUrl(rawUrl, "WebDAV 服务");
}
