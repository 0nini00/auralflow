import { normalizePlaybackQuality } from '@lx/core';
import type { PlaybackAttempt, PlaybackBackend, PlaybackRequest, PlaybackResolvedUrl } from './types';
import { canResolveWithBuiltinMusicApi } from '@/services/builtinMusicApiModel';
import { resolveBuiltinMusicApiUrl } from '@/services/builtinMusicApiClient';

/**
 * 音质标签到网关 br 参数的映射，一对一不做降级。
 *
 * 降级由 playbackResolver 的轮次表统一负责：backend 内部若自行展开到更低 br，
 * 用户选 320k 的首轮就会试到 128，与「所选音质拿不到才降档」的语义冲突。
 */
const QUALITY_BR_MAP: Record<string, string> = {
  flac24bit: '999',
  flac: '740',
  '320k': '320',
  '192k': '192',
  '128k': '128',
};

function getBrCandidates(qualityPreference: string[]): string[] {
  const result: string[] = [];
  for (const quality of qualityPreference) {
    const br = QUALITY_BR_MAP[quality];
    if (br && !result.includes(br)) result.push(br);
  }
  return result.length > 0 ? result : ['320'];
}

export const builtinNeteaseBackend: PlaybackBackend = {
  id: 'builtinNetease',
  name: '内置音乐 API',

  /**
   * 只解析带网关元数据的曲目，不做跨源替代。
   *
   * 曾经在这里做过「同名搜索转译」——tx 曲目缺 gateway 时用「歌名 + 首位歌手」
   * 去网易云搜同名曲顶上。已移除：gdstudio 搜索结果不带 interval，isSameSong 的
   * 时长校验因此永远被跳过，只剩「歌名相同 + 歌手重合」，会匹配到 Live / 翻唱 /
   * 重录 / 同名不同曲；且即便匹配准确，用户点的是 QQ 音乐的曲目却播网易云版本。
   * tx 缺 gateway 时交给自定义音源用真实 songmid 解析。
   */
  async resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl> {
    const variants = request.variants?.length ? request.variants : [request.primary];
    const builtinApiVariants = variants.filter(canResolveWithBuiltinMusicApi);
    const trace: PlaybackAttempt[] = [];

    if (builtinApiVariants.length === 0) {
      throw new Error('内置音乐 API 无该歌曲的解析元数据');
    }

    for (const music of builtinApiVariants) {
      for (const br of getBrCandidates(request.qualityPreference)) {
        try {
          const resolved = await resolveBuiltinMusicApiUrl(music, br);
          // 网关回传的是 br 数字串（"740"/"999"），统一归一化为音质标签：
          // 持久化缓存 key 与降级链查询都按标签匹配，不归一化则缓存永远不命中。
          const quality = normalizePlaybackQuality(resolved.quality);

          trace.push({
            backend: 'builtinNetease',
            resolverName: this.name,
            source: music.source,
            quality,
            status: 'success',
          });
          return {
            url: resolved.url,
            music,
            quality,
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
