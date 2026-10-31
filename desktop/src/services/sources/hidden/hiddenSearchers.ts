import { createKugouHiddenSearcher, createKuwoHiddenSearcher, type HiddenSourceSearcher } from "@lx/core";
import { outboundRequest } from "@/services/outboundHttp";

/**
 * 隐藏兜底音源的原生搜索器。
 *
 * 搜索走各平台公开接口；取链不在这一层——LX 自定义音源脚本只实现 musicUrl，
 * 因此取链由 hiddenFallbackService 交给用户已启用的脚本完成。
 * 顺序即兜底优先次序：先酷我，再酷狗。
 *
 * 这里不用 fetchBuiltinMusicApiText：那个函数只服务静态白名单里的内置网关
 * （plugin-http），而酷我/酷狗域名不在白名单里。固定第三方域名走 Rust 侧
 * proxy_http_request，请求立即发出，超时也只由这里控制。
 */

const HIDDEN_SEARCH_FETCH_TIMEOUT_MS = 6_000;

async function fetchHiddenSourceText(url: string): Promise<string> {
  const response = await outboundRequest(url, {
    method: "GET",
    headers: { Accept: "application/json,text/plain,*/*" },
    timeoutMs: HIDDEN_SEARCH_FETCH_TIMEOUT_MS,
  });
  if (!response.ok) throw new Error(`隐藏音源请求失败: HTTP ${response.status}`);
  return response.text();
}

export const hiddenSourceSearchers: HiddenSourceSearcher[] = [
  createKuwoHiddenSearcher(fetchHiddenSourceText),
  createKugouHiddenSearcher(fetchHiddenSourceText),
];
