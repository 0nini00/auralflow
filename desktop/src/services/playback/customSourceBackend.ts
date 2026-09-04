import { normalizePlaybackQuality } from '@lx/core';
import { useCustomSourceStore } from '@/stores/customSourceStore';
import { requestCustomSourceMusicUrl } from '@/services/customSourceRuntime';
import type { PlaybackAttempt, PlaybackBackend, PlaybackRequest, PlaybackResolvedUrl } from './types';

function compactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
}


export const customSourceBackend: PlaybackBackend = {
  id: 'customSource',
  name: '自定义音源',

  /**
   * 按前端排列顺序逐源尝试(每源带预算):
   *
   * 排前面的源(用户主力)优先——预算内给出本轮最高档即定稿,后面的源零唤醒;
   * 超时 / 失败 / 音质不足本轮期望才轮到下一个源。语义与内置 API 懒切一致,
   * 整条链统一成「按序 + 预算」,前端拖拽排序 = 播放优先级。
   *
   * request.qualityPreference 由 playbackResolver 按轮次传入且从高到低排序,
   * 此处不再自行增删档位——旧实现会给每一轮追加 128k,导致用户选无损时
   * 第一轮就可能拿到 128k。
   */
  async resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl> {
    const customSources = useCustomSourceStore.getState().sources.filter((source) => source.enabled);
    if (!customSources.length) {
      throw new Error('当前备用播放方式为自定义音源,但尚未导入或启用任何 LX Music 自定义音源');
    }

    const variants = request.variants?.length ? request.variants : [request.primary];
    const qualities = request.qualityPreference;
    const targetQuality = qualities[0];
    const trace: PlaybackAttempt[] = [];
    let lastError: unknown;

    for (const music of variants) {
      // 按前端排列顺序逐源尝试,每源 2.5s 预算;达标即定稿,不试后面的源。
      for (const api of customSources) {
        // 该源在本轮音质档内从高到低试,拿到该源最优可用档。
        const sourceAttempt = (async () => {
          const errors: string[] = [];
          for (const quality of qualities) {
            try {
              // 运行时上浮:正常播放取链期间脚本 send updateAlert 且无 waiter 等待时回调,
              // 写入 store 让全局更新弹窗(updateStatus === 'available')能感知;
              // 手动测试/检查更新路径走 waitForUpdateAlert 自行消费,不会重复上报
              const result = await requestCustomSourceMusicUrl(api, music, quality, (alert) => {
                useCustomSourceStore.getState().applyRuntimeUpdateAlert(api.id, alert);
              });
              return {
                apiName: api.name,
                music,
                quality: normalizePlaybackQuality(result.quality || quality),
                url: result.url,
              };
            } catch (error) {
              errors.push(`${quality}: ${compactError(error)}`);
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
          throw new Error(`${api.name} 全部音质失败:${errors.join(' | ')}`);
        })();

        const hit = await withBudget(sourceAttempt, PRIMARY_BUDGET_MS);
        if (hit && normalizePlaybackQuality(hit.quality) === normalizePlaybackQuality(targetQuality)) {
          // 该源在预算内给出本轮最高档 → 定稿,不再试后面的源。
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
        }
        // 未命中:超时或音质不足本轮期望 → 记一笔并轮下一个源。
        lastError = hit
          ? new Error(`${api.name} 音质不足(${hit.quality} < ${targetQuality})`)
          : new Error(`${api.name} 解析超时`);
      }
    }

    const suffix = lastError ? `:${compactError(lastError)}` : '';
    throw new Error(`所有自定义音源都未解析到可播放链接${suffix}`);
  },
};

/** 单源预算:与内置 API 懒切同值。 */
const PRIMARY_BUDGET_MS = 2500;

/** 给 Promise 加预算:超时返回 null(不抛)。 */
async function withBudget<T>(task: Promise<T>, budgetMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), budgetMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

