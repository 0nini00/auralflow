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
      if (!Array.isArray(json)) return [];

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
        quality: String((json as { br?: unknown })?.br ?? br),
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
