import {
  createKugouHiddenSearcher,
  createKuwoHiddenSearcher,
  type HiddenSourceSearcher,
} from "@lx/core";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";

/**
 * 隐藏兜底音源的移动端原生搜索器。
 *
 * 与 hiddenFallbackService 分离，供「自定义音源深度测试」复用：
 * 测试需要按平台搜索固定测试曲，若把搜索器放在 hiddenFallbackService 里，
 * customSourceRuntime 再反过来导入它就会形成循环依赖。
 */

const HIDDEN_SEARCH_FETCH_TIMEOUT_MS = 6_000;

async function fetchHiddenSourceText(url: string): Promise<string> {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "AuralFlowMobile/0.1",
      },
    },
    HIDDEN_SEARCH_FETCH_TIMEOUT_MS,
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`隐藏音源请求失败: HTTP ${response.status}`);
  return text;
}

export const hiddenSourceSearchers: HiddenSourceSearcher[] = [
  createKuwoHiddenSearcher(fetchHiddenSourceText),
  createKugouHiddenSearcher(fetchHiddenSourceText),
];
