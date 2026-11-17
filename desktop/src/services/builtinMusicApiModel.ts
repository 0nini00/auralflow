import type { MusicInfo } from "@lx/core";
import { getBuiltinMusicApiGateway } from "@lx/core";
import { logger } from "@/services/logger";
import { mergeSongSearchMetadata } from "@/services/search/songMetadataMerge";

/**
 * 桌面侧的「内置音乐 API」编排。
 *
 * URL 构造、结果映射、档位/网关解析以及网关客户端本身的唯一实现都在 `@lx/core` 的
 * mobile-api（桌面经 `builtinMusicApiClient.ts` 注入传输层后直接使用）。本文件只保留
 * 桌面特有的编排：网关可用性判定与「主链 + 元数据合并」的搜索策略。
 */
export function canResolveWithBuiltinMusicApi(music: MusicInfo): boolean {
  return getBuiltinMusicApiGateway(music) != null;
}

/** QQ 普通官方取链没有音质字段，不能以请求档位证明返回文件的真实质量。 */
export function canConfirmBuiltinProviderQuality(music: MusicInfo): boolean {
  return music.source !== 'tx' || canResolveWithBuiltinMusicApi(music);
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
        // 主链已有结果，元数据只是增强：不让它拖垮搜索，但失败必须留痕，
        // 否则「封面/时长缺失」无从排查（网关异常响应现在会抛到这里）。
        logger.warn("[search] 元数据来源失败，仅返回主链结果", metadataError);
        return apiSongs;
      }
    }
  } catch (error) {
    apiError = error;
    logger.warn("[search] 主链搜索失败，改用网关兜底", error);
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
