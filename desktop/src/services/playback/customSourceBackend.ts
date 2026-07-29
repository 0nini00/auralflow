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

    for (const music of variants) {
      for (const quality of qualities) {
        const attempts = customSources.map(async (api) => {
          try {
            const result = await requestCustomSourceMusicUrl(api, music, quality);
            return {
              ok: true as const,
              api,
              music,
              quality: result.quality,
              url: result.url,
            };
          } catch (error) {
            return {
              ok: false as const,
              api,
              music,
              quality,
              error,
            };
          }
        });

        const pending = new Set(attempts);
        while (pending.size > 0) {
          const settled = await Promise.race(
            Array.from(pending, (attempt) =>
              attempt.then((value) => ({ attempt, value })),
            ),
          );
          pending.delete(settled.attempt);

          if (settled.value.ok) {
            trace.push({
              backend: 'customSource',
              resolverName: settled.value.api.name,
              source: settled.value.music.source,
              quality: settled.value.quality,
              status: 'success',
            });
            return {
              url: settled.value.url,
              music: settled.value.music,
              quality: settled.value.quality,
              backend: 'customSource',
              resolverName: settled.value.api.name,
              trace,
            };
          }

          lastError = settled.value.error;
          trace.push({
            backend: 'customSource',
            resolverName: settled.value.api.name,
            source: settled.value.music.source,
            quality: settled.value.quality,
            status: 'failed',
            error: compactError(settled.value.error),
          });
        }
      }
    }

    const suffix = lastError ? `：${compactError(lastError)}` : '';
    throw new Error(`所有自定义音源都未解析到可播放链接${suffix}`);
  },
};
