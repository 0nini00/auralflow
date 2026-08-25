import { invoke } from "@tauri-apps/api/core";

/**
 * 运行时可配置目标的出站请求。
 *
 * 不能用 `@tauri-apps/plugin-http`：它的 scope 是 `capabilities/*.json` 里的静态
 * URL 白名单，而 WebDAV 服务地址和自定义音源脚本的请求目标由用户运行时决定，
 * 无法预先列举。这类请求统一走 Rust 侧的 `proxy_http_request`，SSRF 判定与
 * 重定向逐跳校验都在那里完成（见 `src-tauri/src/outbound.rs`）。
 *
 * 固定的第三方 API（网易云 / QQ / B站 / gdstudio / GitHub）仍走 plugin-http，
 * 由静态白名单约束。
 */

export interface OutboundRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** `base64` 用于二进制响应（封面图等）；默认按文本解码。 */
  responseType?: "text" | "base64";
}

export interface OutboundResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  ok: boolean;
  text: () => Promise<string>;
  /** 仅在请求时指定 `responseType: "base64"` 才有意义。 */
  base64: () => string;
}

interface ProxyResponsePayload {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export async function outboundRequest(
  url: string,
  init: OutboundRequestInit = {},
): Promise<OutboundResponse> {
  const payload = await invoke<ProxyResponsePayload>("proxy_http_request", {
    options: {
      url,
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      timeoutMs: init.timeoutMs,
      responseType: init.responseType,
    },
  });

  return {
    status: payload.status,
    statusText: payload.statusText,
    headers: payload.headers,
    ok: payload.status >= 200 && payload.status < 300,
    text: async () => payload.body,
    base64: () => payload.body,
  };
}
