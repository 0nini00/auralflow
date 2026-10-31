import type { MusicInfo } from "@lx/core";
import { getBuiltinMusicApiGateway } from "@lx/core";
import { mergeSongSearchMetadata } from "@/services/search/songMetadataMerge";

/**
 * 桌面侧的「内置音乐 API」门面。
 *
 * URL 构造、结果映射、档位/网关解析的唯一实现在 `@lx/core` 的 mobile-api——
 * 此前这里有一份逐行复刻的副本，且已经实际漂移（core 给 wy 搜索结果补 `mvId`、
 * 桌面副本没有）。本文件只保留桌面特有的编排：网关可用性判定与「主链 + 元数据
 * 合并」的搜索策略。
 */
export {
  BUILTIN_MUSIC_API_BASE,
  buildBuiltinMusicApiUrl,
  getBuiltinMusicApiGateway,
  mapBuiltinMusicApiSong,
  toBuiltinMusicApiBr,
  type BuiltinMusicApiUrlParams,
} from "@lx/core";

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
