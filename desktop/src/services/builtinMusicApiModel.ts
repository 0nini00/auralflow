import type { MusicInfo, SourceTag } from "@lx/core";
import { mergeSongSearchMetadata } from "@/services/search/songMetadataMerge";

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

export function getBuiltinMusicApiGateway(music: MusicInfo) {
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

export function getBuiltinMusicApiSource(music: MusicInfo): string | null {
  return getBuiltinMusicApiGateway(music)?.source ?? null;
}

export function canResolveWithBuiltinMusicApi(music: MusicInfo): boolean {
  return getBuiltinMusicApiGateway(music) != null;
}

export async function searchBuiltinMusicApiFirst(
  apiSearch: () => Promise<MusicInfo[]>,
  fallbackSearch: () => Promise<MusicInfo[]>,
): Promise<MusicInfo[]> {
  let apiError: unknown;

  try {
    const apiSongs = await apiSearch();
    if (apiSongs.length > 0) return apiSongs;
  } catch (error) {
    apiError = error;
  }

  try {
    return await fallbackSearch();
  } catch (fallbackError) {
    if (!apiError) throw fallbackError;

    const apiMessage = apiError instanceof Error ? apiError.message : String(apiError);
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    throw new Error(`内置音乐 API 搜索失败：${apiMessage}\n备用内置音源搜索失败：${fallbackMessage}`);
  }
}

export async function searchBuiltinMusicApiWithMetadata(
  apiSearch: () => Promise<MusicInfo[]>,
  fallbackSearch: () => Promise<MusicInfo[]>,
): Promise<MusicInfo[]> {
  let apiError: unknown;

  try {
    const apiSongs = await apiSearch();
    if (apiSongs.length > 0) {
      try {
        const metadataSongs = await fallbackSearch();
        return mergeSongSearchMetadata(apiSongs, metadataSongs);
      } catch (metadataError) {
        console.warn("歌曲元数据补全失败，保留内置音乐 API 搜索结果", metadataError);
        return apiSongs;
      }
    }
  } catch (error) {
    apiError = error;
  }

  try {
    return await fallbackSearch();
  } catch (fallbackError) {
    if (!apiError) throw fallbackError;

    const apiMessage = apiError instanceof Error ? apiError.message : String(apiError);
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    throw new Error(`内置音乐 API 搜索失败：${apiMessage}\n备用内置音源搜索失败：${fallbackMessage}`);
  }
}

export function toBuiltinMusicApiBr(quality?: string): string {
  if (quality === "128" || quality === "192" || quality === "320" || quality === "740" || quality === "999") {
    return quality;
  }
  if (quality === "128k") return "128";
  if (quality === "192k") return "192";
  if (quality === "320k" || quality === "high") return "320";
  if (quality === "flac") return "740";
  if (quality === "flac24bit") return "999";
  return "320";
}
