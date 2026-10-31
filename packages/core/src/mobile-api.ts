import { normalizePlaybackQuality, type PlaybackQuality } from "./playback-quality";
import type { MusicInfo, SourceTag } from "./sources";

export const BUILTIN_MUSIC_API_BASE = "https://music-api.gdstudio.xyz/api.php";

export interface BuiltinMusicApiUrlParams {
  type: "search" | "url" | "pic" | "lyric";
  source: string;
  id?: string;
  name?: string;
  count?: number;
  pages?: number;
  br?: string;
  size?: number;
}

export interface BuiltinMusicApiGateway {
  source: string;
  trackId: string;
  lyricId?: string;
  picId?: string;
}

export interface BuiltinMusicApiClient {
  searchSongs(source: string, keyword: string, page: number, limit: number, displaySource: Extract<SourceTag, "wy" | "tx">): Promise<MusicInfo[]>;
  resolveUrl(music: MusicInfo, quality?: string): Promise<{ url: string; quality: string }>;
  getLyric(music: MusicInfo): Promise<{ lyric?: string; tlyric?: string }>;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function joinArtists(value: unknown): string {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean).join("、");
  return asString(value);
}

function normalizeNeteaseMvId(value: unknown): string | undefined {
  const mvId = asString(value).trim();
  return mvId && mvId !== "0" ? mvId : undefined;
}

function getJooxPicUrl(picId: string): string | undefined {
  if (!picId) return undefined;
  return `https://image.joox.com/JOOXcover/0/${picId}/300`;
}

export function buildBuiltinMusicApiUrl(params: BuiltinMusicApiUrlParams): string {
  const url = new URL(BUILTIN_MUSIC_API_BASE);
  url.searchParams.set("types", params.type);
  url.searchParams.set("source", params.source);

  if (params.id) url.searchParams.set("id", params.id);
  if (params.name) url.searchParams.set("name", params.name);
  if (params.count != null) url.searchParams.set("count", String(params.count));
  if (params.pages != null) url.searchParams.set("pages", String(params.pages));
  if (params.br) url.searchParams.set("br", params.br);
  if (params.size != null) url.searchParams.set("size", String(params.size));

  return url.toString();
}

export function mapBuiltinMusicApiSong(item: unknown, displaySource: Extract<SourceTag, "wy" | "tx">): MusicInfo | null {
  const raw = item as Record<string, unknown> | null;
  if (!raw) return null;

  const id = asString(raw.id).trim();
  const name = asString(raw.name).trim();
  if (!id || !name) return null;

  const apiSource = asString(raw.source).trim();
  const picId = asString(raw.pic_id).trim();
  const trackId = asString(raw.url_id).trim() || id;
  const lyricId = asString(raw.lyric_id).trim() || id;
  const picUrl = apiSource === "joox" ? getJooxPicUrl(picId) : undefined;

  return {
    id,
    name,
    singer: joinArtists(raw.artist),
    albumName: asString(raw.album),
    source: displaySource,
    quality: "320k",
    picUrl,
    img: picUrl,
    mvId: displaySource === "wy" && (!apiSource || apiSource === "netease")
      ? normalizeNeteaseMvId(raw.mv ?? raw.mvId ?? raw.mv_id)
      : undefined,
    gateway: {
      source: apiSource || displaySource,
      trackId,
      lyricId,
      picId,
    },
  };
}

export function getBuiltinMusicApiGateway(music: MusicInfo): BuiltinMusicApiGateway | null {
  if (music.gateway?.source && music.gateway.trackId) return music.gateway;
  if (music.source === "wy" && music.id) {
    return {
      source: "netease",
      trackId: music.id,
      lyricId: music.id,
      picId: music.id,
    };
  }
  return null;
}

export function toBuiltinMusicApiBr(quality?: string): string {
  if (quality === "128" || quality === "192" || quality === "320" || quality === "740" || quality === "999") return quality;
  if (quality === "128k") return "128";
  if (quality === "192k") return "192";
  if (quality === "320k" || quality === "high") return "320";
  if (quality === "flac") return "740";
  if (quality === "flac24bit") return "999";
  return "320";
}

/** 各档位对应的名义码率（kbps），用于识别网关实际返回的降档。 */
// 网关「名义档位」表：kbps 值是 gdstudio 接口的档位编号语义（flac=740 / flac24bit=999），
// 只用于与网关返回的 br 匹配，不能拿来由字节数估时长——那套标称码率在
// stream-integrity.ts（flac=900 / flac24bit=2000），两者语义不同、数值刻意不同。
const QUALITY_NOMINAL_KBPS: Record<PlaybackQuality, number> = {
  "128k": 128,
  "192k": 192,
  "320k": 320,
  flac: 740,
  flac24bit: 999,
};

/**
 * 把网关回传的 `br` 换算成音质标签。
 *
 * 网关的 `br` 是**实际码率**（kbps），不是请求档位：
 *  - 请求 flac(740) / flac24bit(999) 时，若曲目只有 24bit 母带，两者都回 `br: 3229`；
 *  - 无版权 / 需要会员时回 `br: -1`、`url: ""`；
 *  - 少数平台回 bps（如 320000）。
 *
 * 直接 `normalizePlaybackQuality(String(br))` 会把 3229 归一化成默认的 320k：
 * 用户选无损、实际也听到无损，但 UI 标签、持久化缓存 key、媒体缓存目录全记成 320k，
 * 下次选 flac 时降级链里没有 flac24bit，缓存永远命不中、每次重播都重新解析。
 *
 * 规则：只在网关**明确更低**时诚实降档（请求 320 回 128 → 128k）；
 * 实际码率更高时沿用请求档位——把 flac 请求标成 flac24bit 反而会让「选 flac」
 * 查不到这条记录（降级链只向下看，不含更高档）。
 */
export function resolveBuiltinMusicApiQuality(apiBr: unknown, requestedBr: string): PlaybackQuality {
  const requested = normalizePlaybackQuality(requestedBr);
  const raw = typeof apiBr === "number"
    ? apiBr
    : typeof apiBr === "string"
      ? Number.parseFloat(apiBr)
      : Number.NaN;
  if (!Number.isFinite(raw) || raw <= 0) return requested;

  const kbps = raw > 10_000 ? raw / 1000 : raw;
  // 9 折容差：flac 常见 700-900kbps，不应因为略低于 740 就被判成 320k。
  if (kbps >= QUALITY_NOMINAL_KBPS[requested] * 0.9) return requested;

  if (kbps >= 700) return "flac";
  if (kbps >= 280) return "320k";
  if (kbps >= 170) return "192k";
  return "128k";
}

export function pickBuiltinMusicApiAudioUrl(data: unknown): string | null {
  if (typeof data === "string" && /^https?:\/\//.test(data)) return data;
  if (!data || typeof data !== "object") return null;

  const body = data as {
    url?: unknown;
    data?: { url?: unknown; audio?: { url?: unknown } };
    song?: { url?: unknown };
    result?: { url?: unknown };
  };
  const candidates = [
    body.url,
    body.data?.url,
    body.data?.audio?.url,
    body.song?.url,
    body.result?.url,
    Array.isArray(body) ? body[0]?.url : undefined,
  ];

  return candidates.find((item): item is string => typeof item === "string" && /^https?:\/\//.test(item)) ?? null;
}

export function createBuiltinMusicApiClient(fetchText: (url: string) => Promise<string>): BuiltinMusicApiClient {
  return {
    async searchSongs(source, keyword, page, limit, displaySource) {
      const text = await fetchText(buildBuiltinMusicApiUrl({
        type: "search",
        source,
        name: keyword,
        count: limit,
        pages: page,
      }));
      const json = JSON.parse(text);
      // 非数组响应是网关异常（如 HTML 错误页 / 限流页），按失败处理而非空结果，
      // 否则竞速网关会把「快速空结果」当成成功，吞掉其它网关的真实结果。
      if (!Array.isArray(json)) throw new Error(`内置音乐 API 搜索响应异常: ${text.slice(0, 120)}`);

      return json
        .map((item) => mapBuiltinMusicApiSong(item, displaySource))
        .filter((item): item is MusicInfo => item != null);
    },

    async resolveUrl(music, quality) {
      const gateway = getBuiltinMusicApiGateway(music);
      if (!gateway) throw new Error("该歌曲没有内置音乐 API 解析信息");

      const br = toBuiltinMusicApiBr(quality);
      const text = await fetchText(buildBuiltinMusicApiUrl({
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
        // 网关回的是实际码率（3229 / -1 / 320000），必须换算成标签再交给竞速与缓存。
        quality: resolveBuiltinMusicApiQuality((json as { br?: unknown })?.br, br),
      };
    },

    async getLyric(music) {
      const gateway = getBuiltinMusicApiGateway(music);
      if (!gateway?.lyricId) return {};

      const text = await fetchText(buildBuiltinMusicApiUrl({
        type: "lyric",
        source: gateway.source,
        id: gateway.lyricId,
      }));
      const json = JSON.parse(text);

      return {
        lyric: typeof json?.lyric === "string" ? json.lyric : undefined,
        tlyric: typeof json?.tlyric === "string" ? json.tlyric : undefined,
      };
    },
  };
}

