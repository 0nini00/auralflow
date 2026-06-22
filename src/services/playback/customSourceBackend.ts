import { useCustomSourceStore } from '@/stores/customSourceStore';
import { requestCustomSourceMusicUrl } from '@/services/customSourceRuntime';
import type { PlaybackAttempt, PlaybackBackend, PlaybackRequest, PlaybackResolvedUrl } from './types';

function compactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
}

function getCustomSourceQualities(qualityPreference: string[]): string[] {
  const result: string[] = [];
  const append = (quality: string) => {
    if (!result.includes(quality)) result.push(quality);
  };

  for (const quality of qualityPreference) {
    if (quality === '192k') {
      append('128k');
      continue;
    }
    append(quality);
  }
  if (!result.includes('128k')) result.push('128k');
  return result;
}

export const customSourceBackend: PlaybackBackend = {
  id: 'customSource',
  name: '自定义音源',

  async resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl> {
    const customSources = useCustomSourceStore.getState().sources.filter((source) => source.enabled);
    if (!customSources.length) {
      throw new Error('当前备用播放方式为自定义音源，但尚未导入或启用任何 LX Music 自定义音源');
    }

    const variants = request.variants?.length ? request.variants : [request.primary];
    const qualities = getCustomSourceQualities(request.qualityPreference);
    const trace: PlaybackAttempt[] = [];
    let lastError: unknown;

    for (const api of customSources) {
      for (const music of variants) {
        for (const quality of qualities) {
          try {
            const result = await requestCustomSourceMusicUrl(api, music, quality);
            trace.push({
              backend: 'customSource',
              resolverName: api.name,
              source: music.source,
              quality: result.quality,
              status: 'success',
            });
            return {
              url: result.url,
              music,
              quality: result.quality,
              backend: 'customSource',
              resolverName: api.name,
              trace,
            };
          } catch (error) {
            lastError = error;
            trace.push({
              backend: 'customSource',
              resolverName: api.name,
              source: music.source,
              quality,
              status: 'failed',
              error: compactError(error),
            });
          }
        }
      }
    }

    const suffix = lastError ? `：${compactError(lastError)}` : '';
    throw new Error(`所有自定义音源都未解析到可播放链接${suffix}`);
  },
};
