import type { PlaybackAttempt, PlaybackBackend, PlaybackRequest, PlaybackResolvedUrl } from './types';
import { canResolveWithBuiltinMusicApi } from '@/services/builtinMusicApiModel';
import { resolveBuiltinMusicApiUrl } from '@/services/builtinMusicApiClient';

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

export const builtinNeteaseBackend: PlaybackBackend = {
  id: 'builtinNetease',
  name: '内置音乐 API',

  async resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl> {
    const variants = request.variants?.length ? request.variants : [request.primary];
    const builtinApiVariants = variants.filter(canResolveWithBuiltinMusicApi);
    const trace: PlaybackAttempt[] = [];

    if (builtinApiVariants.length === 0) {
      throw new Error('内置音乐 API 只支持网易云或带内部网关信息的歌曲。');
    }

    for (const music of builtinApiVariants) {
      for (const br of getBrCandidates(request.qualityPreference)) {
        try {
          const resolved = await resolveBuiltinMusicApiUrl(music, br);

          trace.push({
            backend: 'builtinNetease',
            resolverName: this.name,
            source: music.source,
            quality: resolved.quality,
            status: 'success',
          });
          return {
            url: resolved.url,
            music,
            quality: resolved.quality,
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
