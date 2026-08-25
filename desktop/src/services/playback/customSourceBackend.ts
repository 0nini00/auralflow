import { DEFAULT_QUALITY_UPGRADE_WINDOW_MS, normalizePlaybackQuality, raceForBestQuality } from '@lx/core';
import { useCustomSourceStore } from '@/stores/customSourceStore';
import { requestCustomSourceMusicUrl } from '@/services/customSourceRuntime';
import type { PlaybackAttempt, PlaybackBackend, PlaybackRequest, PlaybackResolvedUrl } from './types';

function compactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
}

interface CustomSourceHit {
  apiName: string;
  music: PlaybackRequest['primary'];
  quality: string;
  url: string;
}

export const customSourceBackend: PlaybackBackend = {
  id: 'customSource',
  name: '自定义音源',

  /**
   * 所有「已启用音源 × 本轮音质」组合并发竞速，取其中音质最高者。
   *
   * request.qualityPreference 由 playbackResolver 按轮次传入且从高到低排序：
   * 首轮是「不低于用户选定音质」的全部档位，之后每轮单档。此处不再自行增删
   * 档位——旧实现会给每一轮追加 128k，导致用户选无损时第一轮就可能拿到 128k。
   */
  async resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl> {
    const customSources = useCustomSourceStore.getState().sources.filter((source) => source.enabled);
    if (!customSources.length) {
      throw new Error('当前备用播放方式为自定义音源，但尚未导入或启用任何 LX Music 自定义音源');
    }

    const variants = request.variants?.length ? request.variants : [request.primary];
    const qualities = request.qualityPreference;
    const trace: PlaybackAttempt[] = [];
    let lastError: unknown;

    for (const music of variants) {
      const attempts: Array<Promise<CustomSourceHit>> = [];
      for (const api of customSources) {
        for (const quality of qualities) {
          attempts.push(
            // 运行时上浮：正常播放取链期间脚本 send updateAlert 且无 waiter 等待时回调，
            // 写入 store 让全局更新弹窗（updateStatus === 'available'）能感知；
            // 手动测试/检查更新路径走 waitForUpdateAlert 自行消费，不会重复上报
            requestCustomSourceMusicUrl(api, music, quality, (alert) => {
              useCustomSourceStore.getState().applyRuntimeUpdateAlert(api.id, alert);
            }).then(
              (result) => ({
                apiName: api.name,
                music,
                // 与网关通道一致地归一化，保证缓存 key 和择优排序用同一套标签
                quality: normalizePlaybackQuality(result.quality || quality),
                url: result.url,
              }),
              (error: unknown) => {
                trace.push({
                  backend: 'customSource',
                  resolverName: api.name,
                  source: music.source,
                  quality,
                  status: 'failed',
                  error: compactError(error),
                });
                throw error;
              },
            ),
          );
        }
      }

      try {
        const hit = await raceForBestQuality(attempts, {
          getQuality: (value) => value.quality,
          upgradeWindowMs: DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
          // 本轮最高档一旦命中就无需再等窗口
          ceiling: qualities[0],
        });
        trace.push({
          backend: 'customSource',
          resolverName: hit.apiName,
          source: hit.music.source,
          quality: hit.quality,
          status: 'success',
        });
        return {
          url: hit.url,
          music: hit.music,
          quality: hit.quality,
          backend: 'customSource',
          resolverName: hit.apiName,
          trace,
        };
      } catch (error) {
        lastError = error;
      }
    }

    const suffix = lastError ? `：${compactError(lastError)}` : '';
    throw new Error(`所有自定义音源都未解析到可播放链接${suffix}`);
  },
};
