import type { MusicInfo, SourceTag } from "@lx/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  buildBuiltinMusicApiUrl,
  getBuiltinMusicApiGateway,
  mapBuiltinMusicApiSong,
  toBuiltinMusicApiBr,
} from "@/services/builtinMusicApiModel";

const BROWSER_FETCH_TIMEOUT_MS = 1200;

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
      const resp = await tauriFetch(url, {
        headers: {
          Accept: "application/json,text/plain,*/*",
        },
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 240)}`);
      return text;
    } catch (tauriError) {
      const secondError = tauriError instanceof Error ? tauriError.message : String(tauriError);
      throw new Error(`浏览器 fetch 失败：${firstError}\nTauri fetch 抛出异常：${secondError}`);
    }
  }
}

export async function searchBuiltinMusicApiSongs(
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

export async function resolveBuiltinMusicApiUrl(music: MusicInfo, quality?: string): Promise<{
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

export async function getBuiltinMusicApiLyric(music: MusicInfo): Promise<{ lyric?: string; tlyric?: string }> {
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
