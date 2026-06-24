import type { MusicInfo } from '@lx/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { PlaybackAttempt, PlaybackBackend, PlaybackRequest, PlaybackResolvedUrl } from './types';

const API_BASE = 'https://music-api.gdstudio.xyz/api.php';
const BROWSER_FETCH_TIMEOUT_MS = 1200;

const QUALITY_BR_MAP: Record<string, string[]> = {
  flac: ['740', '320', '128'],
  flac24bit: ['999', '740', '320', '128'],
  '320k': ['320', '128'],
  '192k': ['192', '128'],
  '128k': ['128'],
};

function getBrCandidates(qualityPreference: string[]): string[] {
  const result: string[] = [];
  for (const quality of qualityPreference) {
    for (const br of QUALITY_BR_MAP[quality] ?? ['320', '128']) {
      if (!result.includes(br)) result.push(br);
    }
  }
  return result.length > 0 ? result : ['320', '128'];
}

function isNeteaseMusic(music: MusicInfo): boolean {
  return music.source === 'wy';
}

function pickAudioUrl(data: unknown): string | null {
  if (typeof data === 'string' && /^https?:\/\//.test(data)) return data;
  if (!data || typeof data !== 'object') return null;

  const body = data as any;
  const candidates = [
    body.url,
    body.data?.url,
    body.data?.audio?.url,
    body.song?.url,
    body.result?.url,
    Array.isArray(body) ? body[0]?.url : undefined,
  ];

  const url = candidates.find((item) => typeof item === 'string' && /^https?:\/\//.test(item));
  return url ?? null;
}

async function fetchBuiltinApi(url: string): Promise<string> {
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const browserFetchPromise = window.fetch(url, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
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
      ? browserError.name === 'AbortError'
        ? `请求超时（>${BROWSER_FETCH_TIMEOUT_MS}ms）`
        : browserError.message
      : String(browserError);
    try {
      const resp = await tauriFetch(url, {
        headers: {
          Accept: 'application/json,text/plain,*/*',
        },
      });
      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 240)}`);
      }
      return text;
    } catch (tauriError) {
      const secondError = tauriError instanceof Error ? tauriError.message : String(tauriError);
      throw new Error(`浏览器 fetch 失败：${firstError}\nTauri fetch 抛出异常：${secondError}`);
    }
  }
}

export const builtinNeteaseBackend: PlaybackBackend = {
  id: 'builtinNetease',
  name: '内置网易云播放',

  async resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl> {
    const variants = request.variants?.length ? request.variants : [request.primary];
    const neteaseVariants = variants.filter(isNeteaseMusic);
    const trace: PlaybackAttempt[] = [];

    if (neteaseVariants.length === 0) {
      throw new Error('内置网易云播放只支持网易云来源歌曲。当前歌曲只有 QQ 或其他来源，请切换播放方式。');
    }

    for (const music of neteaseVariants) {
      for (const br of getBrCandidates(request.qualityPreference)) {
        try {
          const url = `${API_BASE}?types=url&source=netease&id=${encodeURIComponent(music.id)}&br=${encodeURIComponent(br)}`;
          const text = await fetchBuiltinApi(url);

          const data = JSON.parse(text);
          const audioUrl = pickAudioUrl(data);
          if (!audioUrl) {
            throw new Error(`接口未返回可播放 URL: ${text.slice(0, 180)}`);
          }

          trace.push({
            backend: 'builtinNetease',
            resolverName: this.name,
            source: music.source,
            quality: br,
            status: 'success',
          });
          return {
            url: audioUrl,
            music,
            quality: br,
            backend: 'builtinNetease',
            resolverName: this.name,
            trace,
          };
        } catch (error) {
          trace.push({
            backend: 'builtinNetease',
            resolverName: this.name,
            source: music.source,
            quality: br,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const detail = trace.map((item) => `${item.source.toUpperCase()} ${item.quality}: ${item.error ?? item.status}`).join('\n');
    throw new Error(detail || '内置网易云播放解析失败');
  },
};
