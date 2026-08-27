/**
 * 桌面端竞速胜出 URL 探活 + 完整资源字节数读取（试听片段判定）。
 *
 * 探活目标是竞速解析出的音频 CDN URL，域名由网关/音源脚本运行时决定，
 * 无法预先列举到 capabilities 白名单——不能用 @tauri-apps/plugin-http
 * （会被白名单拒绝）。统一走 outboundRequest（Rust proxy_http_request），
 * 不受白名单限制，且自带 SSRF 守卫与逐跳重定向验证。
 */
import { outboundRequest } from "@/services/outboundHttp";
import { parseContentRangeTotal } from "@lx/core";

/** 探活超时：与移动端一致，5s 内无响应即判死。 */
export const PROBE_TIMEOUT_MS = 5_000;

export type StreamProbeResult =
  | { ok: true; totalBytes?: number }
  | { ok: false; reason: string };

/**
 * 从响应头读取完整资源字节数。
 *
 * 优先读 Content-Range（bytes 0-0/TOTAL）拿到完整大小；Content-Range 缺失时
 * 回退 Content-Length——但探活发的是 Range: bytes=0-0，分片响应的
 * Content-Length 只代表分片大小（1 字节），不是完整文件大小，直接用它估算
 * 时长会把所有歌曲误判为试听片段。因此仅当请求不是分片请求时才回退
 * Content-Length。
 */
function readTotalBytes(headers: Record<string, string>, rangeRequested: boolean): number | undefined {
  // Rust proxy_http_request 返回的 headers 是小写 key 的普通对象（reqwest HeaderMap 序列化）
  const contentRange = headers["content-range"] ?? headers["Content-Range"];
  if (contentRange) {
    const fromRange = parseContentRangeTotal(contentRange);
    if (fromRange != null) return fromRange;
  }
  // 仅在非分片请求时回退 Content-Length：分片请求的 Content-Length 是分片大小而非完整大小
  if (rangeRequested) return undefined;
  const contentLength = headers["content-length"] ?? headers["Content-Length"];
  if (contentLength != null && /^\d+$/.test(contentLength.trim())) {
    return Number(contentLength);
  }
  return undefined;
}

export async function probeStreamUrl(
  url: string,
  headers: Record<string, string> | undefined,
): Promise<StreamProbeResult> {
  if (!/^https?:\/\//i.test(url)) return { ok: true };
  try {
    const response = await outboundRequest(url, {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-0" },
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (response.ok) {
      const totalBytes = readTotalBytes(response.headers, true);
      return { ok: true, totalBytes };
    }
    return { ok: false, reason: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
