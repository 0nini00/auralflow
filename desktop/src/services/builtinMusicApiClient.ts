import type { MusicInfo, SourceTag } from "@lx/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  buildBuiltinMusicApiUrl,
  getBuiltinMusicApiGateway,
  mapBuiltinMusicApiSong,
  toBuiltinMusicApiBr,
} from "@/services/builtinMusicApiModel";

// 网关冷请求常需 1.8-2.6s，超时过短会把可用结果也掐掉、白白走一轮 Tauri 兜底。
const BROWSER_FETCH_TIMEOUT_MS = 6_000;
/** Tauri fetch fallback 的超时。比浏览器路径宽松（它专治 CORS/被拦场景），但必须有上限。 */
const TAURI_FETCH_TIMEOUT_MS = 10_000;

function pickAudioUrl(data: unknown): string | null {
  if (typeof data === "string" && /^https?:\/\//.test(data)) return data;
  if (!data || typeof data !== "object") return null;

  const body = data as any;
  const candidates = [
    body.url,
    body.data?.url,
    body.data?.audio?.url,
    body.song?.url,
    body.result?.url,
    Array.isArray(body) ? body[0]?.url : undefined,
  ];

  return candidates.find((item) => typeof item === "string" && /^https?:\/\//.test(item)) ?? null;
}

export async function fetchBuiltinMusicApiText(url: string): Promise<string> {
  try {
    if (typeof window === "undefined" || typeof window.fetch !== "function") {
      throw new Error("浏览器 fetch 不可用");
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const browserFetchPromise = window.fetch(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
      },
      signal: controller?.signal,
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller?.abort();
        reject(new Error(`请求超时（>${BROWSER_FETCH_TIMEOUT_MS}ms）`));
      }, BROWSER_FETCH_TIMEOUT_MS);
    });
    const resp = await Promise.race([browserFetchPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 240)}`);
    return text;
  } catch (browserError) {
    const firstError = browserError instanceof Error
      ? browserError.name === "AbortError"
        ? `请求超时（>${BROWSER_FETCH_TIMEOUT_MS}ms）`
        : browserError.message
      : String(browserError);
    try {
      // Tauri 的 http 插件底层是 reqwest，默认不设超时；不显式中断会让弱网下的
      // 切歌请求长期挂起。这里给 fallback 路径同样加上超时。
      const fallbackController =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const fallbackTimer = setTimeout(
        () => fallbackController?.abort(),
        TAURI_FETCH_TIMEOUT_MS,
      );
      try {
        const resp = await tauriFetch(url, {
          headers: {
            Accept: "application/json,text/plain,*/*",
          },
          signal: fallbackController?.signal,
        });
        const text = await resp.text();
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 240)}`);
        return text;
      } finally {
        clearTimeout(fallbackTimer);
      }
    } catch (tauriError) {
      const secondError = tauriError instanceof Error
        ? tauriError.name === "AbortError"
          ? `请求超时（>${TAURI_FETCH_TIMEOUT_MS}ms）`
          : tauriError.message
        : String(tauriError);
      throw new Error(`浏览器 fetch 失败：${firstError}\nTauri fetch 抛出异常：${secondError}`);
    }
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
  const audioUrl = pickAudioUrl(json);
  if (!audioUrl) throw new Error(`接口未返回可播放 URL: ${text.slice(0, 180)}`);

  return {
    url: audioUrl,
    quality: String((json as any)?.br ?? br),
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
