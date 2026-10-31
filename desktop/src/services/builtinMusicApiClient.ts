import type { MusicInfo, SourceTag } from "@lx/core";
import {
  pickBuiltinMusicApiAudioUrl,
  resolveBuiltinMusicApiQuality,
} from "@lx/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  buildBuiltinMusicApiUrl,
  getBuiltinMusicApiGateway,
  mapBuiltinMusicApiSong,
  toBuiltinMusicApiBr,
} from "@/services/builtinMusicApiModel";

// 网关冷请求实测 1.8-2.6s；上限不能太短（会把可用结果掐掉），也不能太长
// （解析链总预算只有 14s）。两条通道共享这一个预算，不再各自计时。
const GATEWAY_REQUEST_TIMEOUT_MS = 10_000;

/** 单次 fetch 的统一超时与错误包装。 */
async function fetchTextWithTimeout(
  fetcher: (input: string, init: RequestInit) => Promise<Response>,
  url: string,
  timeoutMs: number,
  label: string,
): Promise<string> {
  const chunk = Math.max(500, timeoutMs);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), chunk);
  try {
    const resp = await fetcher(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
      },
      signal: controller?.signal,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 240)}`);
    return text;
  } catch (error) {
    const message = error instanceof Error
      ? error.name === "AbortError"
        ? `请求超时（>${chunk}ms）`
        : error.message
      : String(error);
    throw new Error(`${label}：${message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 网关请求：Tauri(reqwest) 优先，WebView 的 window.fetch 只作兜底。
 *
 * 顺序曾被写反。网关响应不带 `Access-Control-Allow-Origin`，浏览器通道在跨域
 * 场景下必然失败——每首歌都先白跑一次注定失败的请求；更糟的是两条通道各自
 * 计时（6s + 10s = 16s），串起来会顶穿解析链 14s 的总预算，让真正可用的
 * Tauri 结果还没返回就被判超时。
 *
 * 现在两条通道共享一个 deadline：Tauri 失败后浏览器只拿剩余时间。
 */
export async function fetchBuiltinMusicApiText(
  url: string,
  timeoutMs: number = GATEWAY_REQUEST_TIMEOUT_MS,
): Promise<string> {
  const deadlineAt = Date.now() + Math.max(500, timeoutMs);
  let tauriError: string;
  try {
    return await fetchTextWithTimeout(
      // plugin-http 的 fetch 走 Rust，不受 CORS 约束，是桌面端的主通道。
      (input, init) => tauriFetch(input, init),
      url,
      deadlineAt - Date.now(),
      "Tauri fetch",
    );
  } catch (error) {
    tauriError = error instanceof Error ? error.message : String(error);
  }

  const remaining = deadlineAt - Date.now();
  if (typeof window === "undefined" || typeof window.fetch !== "function" || remaining < 300) {
    throw new Error(tauriError);
  }

  try {
    return await fetchTextWithTimeout(
      (input, init) => window.fetch(input, init),
      url,
      remaining,
      "浏览器 fetch",
    );
  } catch (browserError) {
    const browserMessage = browserError instanceof Error ? browserError.message : String(browserError);
    throw new Error(`${tauriError}\n${browserMessage}`);
  }
}

async function searchBuiltinMusicApiSongsGdstudio(
  source: string,
  keyword: string,
  page: number,
  limit: number,
  displaySource: Extract<SourceTag, "wy" | "tx">,
): Promise<MusicInfo[]> {
  const text = await fetchBuiltinMusicApiText(buildBuiltinMusicApiUrl({
    type: "search",
    source,
    name: keyword,
    count: limit,
    pages: page,
  }));
  const json = JSON.parse(text);
  if (!Array.isArray(json)) return [];

  return json
    .map((item) => mapBuiltinMusicApiSong(item, displaySource))
    .filter((item): item is MusicInfo => item != null);
}

async function resolveBuiltinMusicApiUrlGdstudio(music: MusicInfo, quality?: string): Promise<{
  url: string;
  quality: string;
}> {
  const gateway = getBuiltinMusicApiGateway(music);
  if (!gateway) throw new Error("该歌曲没有内置音乐 API 解析信息");

  const br = toBuiltinMusicApiBr(quality);
  const text = await fetchBuiltinMusicApiText(buildBuiltinMusicApiUrl({
    type: "url",
    source: gateway.source,
    id: gateway.trackId,
    br,
  }));
  const json = JSON.parse(text);
  const audioUrl = pickBuiltinMusicApiAudioUrl(json);
  if (!audioUrl) throw new Error(`接口未返回可播放 URL: ${text.slice(0, 180)}`);

  return {
    url: audioUrl,
    // 网关回的是实际码率（flac 常见 3229、无版权为 -1），换算成标签再交给竞速与缓存。
    quality: resolveBuiltinMusicApiQuality((json as any)?.br, br),
  };
}

async function getBuiltinMusicApiLyricGdstudio(music: MusicInfo): Promise<{ lyric?: string; tlyric?: string }> {
  const gateway = getBuiltinMusicApiGateway(music);
  if (!gateway?.lyricId) return {};

  const text = await fetchBuiltinMusicApiText(buildBuiltinMusicApiUrl({
    type: "lyric",
    source: gateway.source,
    id: gateway.lyricId,
  }));
  const json = JSON.parse(text);

  return {
    lyric: typeof json?.lyric === "string" ? json.lyric : undefined,
    tlyric: typeof json?.tlyric === "string" ? json.tlyric : undefined,
  };
}

/**
 * 内置音乐 API 搜索（gdstudio 网关直通）。
 * 空数组/异常响应按失败处理，由上层（searchBuiltinMusicApiWithMetadata）回退官方直连。
 */
export function searchBuiltinMusicApiSongs(
  source: string,
  keyword: string,
  page: number,
  limit: number,
  displaySource: Extract<SourceTag, "wy" | "tx">,
): Promise<MusicInfo[]> {
  return searchBuiltinMusicApiSongsGdstudio(source, keyword, page, limit, displaySource);
}

/**
 * 内置音乐 API 解析播放 URL（gdstudio 网关直通）。
 * 入参兼容 br 数值（128/320/740/999）与音质标签。
 */
export function resolveBuiltinMusicApiUrl(music: MusicInfo, quality?: string): Promise<{
  url: string;
  quality: string;
}> {
  return resolveBuiltinMusicApiUrlGdstudio(music, quality);
}

/** 内置音乐 API 拉取歌词（gdstudio 网关直通）。 */
export function getBuiltinMusicApiLyric(music: MusicInfo): Promise<{ lyric?: string; tlyric?: string }> {
  return getBuiltinMusicApiLyricGdstudio(music);
}
