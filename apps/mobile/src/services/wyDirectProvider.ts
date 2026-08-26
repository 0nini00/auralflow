import CryptoJS from "crypto-js";
import type { MusicInfo } from "@lx/core";
import { getWyCookie } from "./wyAccountService";
import { postWyWeapi } from "./wyPlaylistService";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import type { PlaybackQuality } from "./playbackQualityModel";

/**
 * 网易云直连播放 URL 解析（对齐桌面端 wyProvider）。
 *
 * 背景：移动端此前解析 wy 音源只走第三方网关（music-api.gdstudio.xyz），
 * 网关不稳定/限流时返回空 URL 或 403（实机验证：未登录状态全部 403 Source error）。
 * 此模块直连网易云接口，作为网关的官方直连路径：
 *   1. 已登录 → weapi /song/enhance/player/url/v1（带 Cookie，最可靠）
 *   2. 免登录 → eapi /eapi/song/enhance/player/url（部分免费歌曲可用）
 *
 * 当前播放策略为「纯网关」（用户选择），resolveWySongUrl 暂未接线，
 * 保留此实现供恢复「官方直连优先」时直接复用（桌面端 wyProvider 同款逻辑）。
 * eapiEncrypt 仍被 wySearchService（cloudsearch 搜索）使用；
 * postWyEapi 为通用 eapi POST，供本模块播放 URL 与 musicApi 歌词直连共用。
 */

const WY_EAPI_KEY = "e82ckenh8dichen8";
const WY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/**
 * eapi 请求加密（网易云接口通用，播放 URL 与 cloudsearch 搜索共用）。
 * @param url 接口路径（如 /api/song/enhance/player/url）
 */
export function eapiEncrypt(url: string, object: Record<string, unknown>): string {
  const text = JSON.stringify(object);
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = CryptoJS.MD5(message).toString();
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(data),
    CryptoJS.enc.Utf8.parse(WY_EAPI_KEY),
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }
  ).ciphertext.toString(CryptoJS.enc.Hex).toUpperCase();
}

function wyLevelForQuality(quality: PlaybackQuality): string {
  switch (quality) {
    case "128k":
      return "standard";
    case "192k":
      return "higher";
    case "flac":
      return "lossless";
    case "flac24bit":
      return "hires";
    case "320k":
    default:
      return "exhigh";
  }
}

function wyBrForQuality(quality: PlaybackQuality): number {
  switch (quality) {
    case "128k":
      return 128000;
    case "192k":
      return 192000;
    case "flac":
    case "flac24bit":
      return 999000;
    case "320k":
    default:
      return 320000;
  }
}

/**
 * eapi 通用 POST（网易云免登录直连，播放 URL / 歌词等接口共用）。
 * @param path 加密用接口路径（如 /api/song/lyric/v1），实际请求 /eapi/ 下同名路径
 * @returns 已解析 JSON；HTTP 非 2xx 或业务 code 非 200（字段存在时）抛错
 */
export async function postWyEapi(
  path: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const response = await fetchWithTimeout(
    `https://interface3.music.163.com/eapi/${path.replace(/^\/api\//, "")}`,
    {
      method: "POST",
      headers: {
        "User-Agent": WY_UA,
        Origin: "https://music.163.com",
        Referer: "https://music.163.com",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `params=${encodeURIComponent(eapiEncrypt(path, params))}`,
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`eapi HTTP ${response.status}: ${text.slice(0, 160)}`);
  }
  const json = JSON.parse(text) as { code?: unknown };
  const code = Number(json?.code);
  if (Number.isFinite(code) && code !== 200) {
    throw new Error(`eapi code ${code}`);
  }
  return json;
}

/**
 * 直连解析网易云歌曲播放 URL。
 * @throws 两级直连都失败时抛错（含原因），调用方负责回退网关。
 */
export async function resolveWySongUrl(
  song: MusicInfo,
  quality: PlaybackQuality = "320k",
): Promise<string> {
  const idNum = Number(song.id);
  if (!Number.isFinite(idNum)) {
    throw new Error("网易云歌曲 ID 无效");
  }

  // 1. weapi + Cookie（已登录时最可靠）
  // 失败原因必须带到最终错误里：无版权/需要 VIP 与网络错误的处置方式完全不同，
  // 静默吞掉会让用户只看到 eapi 的报错，误以为是网络问题。
  const cookie = await getWyCookie();
  let weapiFailure: string | null = null;
  if (cookie) {
    try {
      const body = await postWyWeapi<{ data?: Array<{ url?: string; code?: unknown; fee?: unknown }> }>(
        "/song/enhance/player/url/v1",
        {
          ids: `[${idNum}]`,
          level: wyLevelForQuality(quality),
          encodeType: "flac",
        },
        cookie,
      );
      const entry = body?.data?.[0];
      const url = entry?.url;
      if (url && url.length > 0) return url;
      weapiFailure = `未返回播放地址，歌曲可能无版权或需要 VIP`;
    } catch (error) {
      weapiFailure = `weapi 失败：${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    weapiFailure = "未登录网易云";
  }

  // 2. eapi 免登录
  try {
    const json = (await postWyEapi("/api/song/enhance/player/url", {
      ids: [idNum],
      br: wyBrForQuality(quality),
    })) as { data?: Array<{ url?: string }> };
    const url = json?.data?.[0]?.url;
    if (url && url.length > 0) return url;
    throw new Error("eapi 未返回可播放 URL");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = weapiFailure ? `${weapiFailure}；` : "";
    throw new Error(`网易云直连解析失败：${prefix}${message}`);
  }
}
