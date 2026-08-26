/**
 * 竞速胜出 URL 探活：发 1 字节 Range 请求验证服务器真的能出数据，并尽可能
 * 读取完整资源字节数供试听片段判定（见 @lx/core stream-integrity）。
 *
 * 针对的场景：
 * 1. 死代理：LX 音源代理等黑盒服务器 TCP 握手成功后不返回任何字节，ExoPlayer
 *    会无限缓冲且无任何错误回调，用户侧表现为「正在播放但进度永远 00:00」。
 * 2. 试听片段：30s 试听与完整版同样返回 200/206，靠 Content-Range / Content-Length
 *    拿到总量后按期望时长判定，避免试听进播放器与缓存。
 */
import { parseContentRangeTotal } from "@lx/core";
import { fetchWithTimeout, isTimeoutError } from "@/utils/fetchWithTimeout";

/** 探活超时：死代理 TCP 连上后永不返数据，1 字节 Range 也拉不同，5s 内无响应即判死。 */
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
  // 本地文件与非 HTTP(S) 协议无需探活
  if (!/^https?:\/\//i.test(url)) return { ok: true };
  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: { ...headers, Range: "bytes=0-0" },
        // 探活请求无需携带 Cookie，避免干扰服务端会话判定
        credentials: "omit",
      },
      PROBE_TIMEOUT_MS,
    );
    // 2xx/206 均视为可用；3xx 重定向 fetch 已自动跟随；403/404/5xx 判死
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, totalBytes: readTotalBytes(response.headers) };
    }
    return { ok: false, reason: `HTTP ${response.status}` };
  } catch (error) {
    if (isTimeoutError(error)) {
      return { ok: false, reason: `无响应（>${PROBE_TIMEOUT_MS / 1000}s）` };
    }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
