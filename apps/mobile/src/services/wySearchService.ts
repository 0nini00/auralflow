import type { MusicInfo } from "@lx/core";
import { eapiEncrypt } from "./wyDirectProvider";
import { mapWyTrackToMusicInfo } from "./wyMusicMapper";
import { getWyCookie } from "./wyAccountService";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";

/**
 * 网易云直连搜索（eapi cloudsearch，免登录）。
 *
 * 背景：移动端此前歌曲搜索只走第三方网关（music-api.gdstudio.xyz），网关不稳定/
 * 限流时返回空列表。此模块直连网易云 cloudsearch 接口，作为网关之后的兜底/
 * 元数据补全来源，与桌面端 wyProvider.search → searchWyViaCloudSearch 对齐。
 */

const WY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const WY_CLOUDSEARCH_EAPI_URL = "https://interface3.music.163.com/eapi/cloudsearch/pc";

/**
 * cloudsearch 直连搜索单曲（type=1）。
 * @throws 接口失败/返回异常时抛错，由调用方（musicApi.searchSongs）决定回退。
 */
export async function searchWySongsViaCloudSearch(
  keyword: string,
  limit = 30,
): Promise<MusicInfo[]> {
  const query = keyword.trim();
  if (!query) return [];

  const params = eapiEncrypt("/api/cloudsearch/pc", {
    s: query,
    type: 1, // 1=单曲（对齐桌面 searchWyViaCloudSearch）
    limit,
    offset: 0,
  });

  const cookie = await getWyCookie();
  const headers: Record<string, string> = {
    "User-Agent": WY_UA,
    Origin: "https://music.163.com",
    Referer: "https://music.163.com",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (cookie) headers["Cookie"] = cookie;

  const response = await fetchWithTimeout(WY_CLOUDSEARCH_EAPI_URL, {
    method: "POST",
    headers,
    body: `params=${encodeURIComponent(params)}`,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`cloudsearch HTTP ${response.status}: ${text.slice(0, 160)}`);
  }

  const json = JSON.parse(text) as { code?: number; result?: { songs?: unknown[] } };
  if (json.code !== 200) {
    throw new Error(`cloudsearch code=${json.code}`);
  }
  return (json.result?.songs ?? []).map(mapWyTrackToMusicInfo);
}
