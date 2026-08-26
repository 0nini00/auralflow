/**
 * 桌面端竞速胜出 URL 探活 + 完整资源字节数读取（试听片段判定）。
 *
 * 与移动端 probeStreamUrl 同语义；差异只在请求通道：桌面 WebView 里浏览器 fetch
 * 对跨域 CDN 读 Content-Range 头受 CORS 限制（需 Access-Control-Expose-Headers），
 * 因此走 tauri-plugin-http（reqwest，无 CORS），由 Rust 侧按白名单出站。
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { parseContentRangeTotal } from "@lx/core";

/** 探活超时：与移动端一致，5s 内无响应即判死。 */
export const PROBE_TIMEOUT_MS = 5_000;

export type StreamProbeResult =
  | { ok: true; totalBytes?: number }
  | { ok: false; reason: string };

function readTotalBytes(headers: Headers): number | undefined {
  const contentRange = headers.get("content-range");
  if (contentRange) {
    const fromRange = parseContentRangeTotal(contentRange);
    if (fromRange != null) return fromRange;
  }
  const contentLength = headers.get("content-length");
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await tauriFetch(url, {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-0" },
      signal: controller.signal,
    });
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, totalBytes: readTotalBytes(response.headers) };
    }
    return { ok: false, reason: `HTTP ${response.status}` };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: `无响应（>${PROBE_TIMEOUT_MS / 1000}s）` };
    }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
