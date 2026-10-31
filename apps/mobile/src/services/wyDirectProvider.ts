import CryptoJS from "crypto-js";
import type { MusicInfo } from "@lx/core";
import { getWyCookie } from "./wyAccountService";
import { postWyWeapi } from "./wyPlaylistService";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import type { PlaybackQuality } from "./playbackQualityModel";
import { getPlaybackQualityRank } from "./playbackQualityModel";

/**
 * 网易云直连播放 URL 解析（对齐桌面端 wyProvider）。
 *
 * 背景：移动端此前解析 wy 音源只走第三方网关（music-api.gdstudio.xyz），
 * 网关不稳定/限流时返回空 URL 或 403（实机验证：未登录状态全部 403 Source error）。
 * 此模块直连网易云接口，作为网关的官方直连路径：
 *   1. 已登录 → weapi /song/enhance/player/url/v1（带 Cookie，最可靠）
 *   2. 免登录 → eapi /eapi/song/enhance/player/url（部分免费歌曲可用）
 *
 * resolveWySongUrl 现已接线三处：会员直连优先（officialPriority 开启时作为
 * raceQualityTier 的主源）、云盘曲短路、竞速全败后的最后兜底；下载链路经
 * resolveCloudSongUrl 共用。eapiEncrypt 仍被 wySearchService（cloudsearch 搜索）
 * 使用；postWyEapi 为通用 eapi POST，供本模块播放 URL 与 musicApi 歌词直连共用。
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

/** 上表的反向索引：wy 响应里的 `level` → 音质标签（与桌面 wyProvider 同一口径）。 */
const WY_QUALITY_BY_LEVEL: Record<string, PlaybackQuality> = Object.fromEntries(
  (["128k", "192k", "320k", "flac", "flac24bit"] as PlaybackQuality[]).map((quality) => [
    wyLevelForQuality(quality),
    quality,
  ]),
);

/**
 * wy 返回的 `level` 是否明确低于请求档位。
 *
 * 官方接口对无权限歌曲会自行降级应答：请求 hires 拿到 lossless 也照样返回 URL。
 * 不拦的话「320k 的音源」会被写进 flac24bit 的缓存 key 与 UI 标签——桌面端
 * `wyProvider` 一直有这条判定，移动端此前缺了它，会员直连提起后会立刻暴露。
 *
 * fail-open：level 缺失 / 非字符串 / 不认识（新版 jyeffect、sky…）一律放行，
 * 响应形状变化不该让本可播放的歌播不出来。
 */
function isWyLevelBelowRequested(level: unknown, requestedRank: number): boolean {
  if (typeof level !== "string") return false;
  const actual = WY_QUALITY_BY_LEVEL[level.trim().toLowerCase()];
  if (!actual) return false;
  return getPlaybackQualityRank(actual) < requestedRank;
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
  const requestedRank = getPlaybackQualityRank(quality);
  if (cookie) {
    try {
      const body = await postWyWeapi<{
        data?: Array<{ url?: string; code?: unknown; fee?: unknown; level?: unknown }>;
      }>(
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
      // 云盘曲不做转码：返回的 level 就是上传文件本身的码率，不按档位拒绝
      // （与桌面 wyProvider 同语义）；否则 128k 上传在默认档位下会被反复重试。
      if (url && url.length > 0 && (song.wyCloud === true || !isWyLevelBelowRequested(entry?.level, requestedRank))) {
        return url;
      }
      if (url && url.length > 0) {
        weapiFailure = `返回音质 ${String(entry?.level)} 低于请求档位 ${quality}`;
      } else {
        weapiFailure = `未返回播放地址，歌曲可能无版权或需要 VIP`;
      }
    } catch (error) {
      weapiFailure = `weapi 失败：${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    weapiFailure = "未登录网易云";
  }

  // 2. eapi 免登录
  // 云盘曲不走 eapi：eapi 不带 Cookie，拿不到账号的私有文件；而 matched 上传（占 25%）
  // 的同一个数字 id 在线上也有一份录音，eapi 可能返回线上版本而不是用户上传的那份。
  // 宁可如实失败，让用户看到「登录过期」而不是听到另一份音频。
  if (song.wyCloud === true) {
    throw new Error(
      `网易云直连解析失败：${weapiFailure || "未登录网易云"}（云盘文件只能通过账号 Cookie 读取）`,
    );
  }
  try {
    const json = (await postWyEapi("/api/song/enhance/player/url", {
      ids: [idNum],
      br: wyBrForQuality(quality),
    })) as { data?: Array<{ url?: string; level?: unknown }> };
    const entry = json?.data?.[0];
    const url = entry?.url;
    if (url && url.length > 0) {
      if (isWyLevelBelowRequested(entry?.level, requestedRank)) {
        throw new Error(`返回音质 ${String(entry?.level)} 低于请求档位 ${quality}`);
      }
      return url;
    }
    throw new Error("eapi 未返回可播放 URL");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = weapiFailure ? `${weapiFailure}；` : "";
    throw new Error(`网易云直连解析失败：${prefix}${message}`);
  }
}
