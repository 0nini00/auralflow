import { assertPublicOutboundUrl } from "@lx/core";

export function assertHttpsWebdavUrl(rawUrl: string): URL {
  const parsed = assertPublicOutboundUrl(rawUrl, "WebDAV 服务");
  if (parsed.protocol !== "https:") {
    throw new Error("WebDAV 服务仅支持 HTTPS 地址");
  }
  return parsed;
}
