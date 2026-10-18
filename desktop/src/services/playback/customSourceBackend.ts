import {
  DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
  DEFAULT_SOURCE_STAGGER_MS,
  normalizePlaybackQuality,
  raceStaggeredPriority,
} from '@lx/core';
import { customSourceAccess, customSourcePersistence, useCustomSourceStore } from '@/stores/customSourceStore';
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
   * 按前端排列顺序交错启动的竞速(raceStaggeredPriority):
   *
   * 前一个源结算立即启动下一个;未结算则最多等交错间隔并行启动下一个,
   * 交错总展开由 CUSTOM_SOURCE_SPREAD_MS 封顶(实测 7 源 × 800ms 会把队尾
   * 唯一可用源(HYW,tx)推后 4.8s,叠加服务端 2-10s 慢回退直接顶穿预算)。
   * 前端排序 = 优先权(同档结果更靠前的源优先定稿),而非独占权——旧实现给每源
   * 2.5s 固定预算,走第三方代理的 LX 脚本正常耗时可达 3s+,会被系统性击杀。
   * 达标(不低于本轮最低档)即从该源定稿,其后的源零唤醒。
   *
   * request.qualityPreference 由 playbackResolver 传入完整降级链(从选定音质到
   * 128k,高到低)且轮次间只竞速一次;此处不自行增删档位——旧实现会给每一轮
   * 追加 128k,导致用户选无损时第一轮就可能拿到 128k。
   */
  async resolve(request: PlaybackRequest): Promise<PlaybackResolvedUrl> {
    if (!useCustomSourceStore.getState().featureReady) await customSourcePersistence.ready;
    const operation = customSourceAccess.capture();
    const customSources = useCustomSourceStore.getState().sources.filter((source) => source.enabled);
    if (!customSources.length) {
      throw new Error('当前备用播放方式为自定义音源,但尚未导入或启用任何 LX Music 自定义音源');
    }

    const variants = request.variants?.length ? request.variants : [request.primary];
    const qualities = request.qualityPreference;
    if (!qualities.length) throw new Error('没有可尝试的音质档位');
    const floorQuality = qualities[qualities.length - 1];
    const trace: PlaybackAttempt[] = [];
    const budgetEndsAt = Date.now() + CUSTOM_SOURCE_TOTAL_BUDGET_MS;
    const failures: string[] = [];

    for (const music of variants) {
      const remaining = budgetEndsAt - Date.now();
      if (remaining <= CUSTOM_SOURCE_MIN_ATTEMPT_MS) {
        failures.push(`时间预算耗尽,未尝试变体 ${music.name}`);
        break;
      }

      // 每个源:源内部也走同一个交错竞速——最高档先发,未回就在交错期后并发降档;
      // 首个达标结果开启升级窗口,最高档在窗口内赶上仍可翻盘。
      // 旧实现按档位串行等待:服务端对高清单走慢回退路径(实测 flac24bit 18.7s 才回
      // 320k 兜底,而 flac 只要 2.1s)时,整源被拖死,真正可用的档位从未被请求。
      const outcomes = customSources.map<string | undefined>(() => undefined);
      const launchers = customSources.map((api, index) => () => (async (): Promise<CustomSourceHit> => {
        operation.assertActive();
        const qualityLaunchers = qualities.map((requested) => () => (async () => {
          operation.assertActive();
          try {
            // 运行时上浮:正常播放取链期间脚本 send updateAlert 且无 waiter 等待时回调,
            // 写入 store 让全局更新弹窗(updateStatus === 'available')能感知;
            // 手动测试/检查更新路径走 waitForUpdateAlert 自行消费,不会重复上报
            const result = await requestCustomSourceMusicUrl(api, music, requested, operation, (alert) => {
              operation.assertActive();
              useCustomSourceStore.getState().applyRuntimeUpdateAlert(api.id, alert);
            });
            operation.assertActive();
            return { quality: normalizePlaybackQuality(result.quality || requested), url: result.url };
          } catch (error) {
            operation.assertActive();
            trace.push({
              backend: 'customSource',
              resolverName: api.name,
              source: music.source,
              quality: requested,
              status: 'failed',
              error: compactError(error),
            });
            throw new Error(`${requested}: ${compactError(error)}`);
          }
        })());
        try {
          const hit = await raceStaggeredPriority(qualityLaunchers, {
            getQuality: (value) => value.quality,
            floor: floorQuality,
            ceiling: qualities[0],
            staggerMs: DEFAULT_SOURCE_STAGGER_MS,
            maxSpreadMs: CUSTOM_SOURCE_SPREAD_MS,
            upgradeWindowMs: DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
            formatError: (errors) =>
              new Error(errors.map((error) => (error instanceof Error ? error.message : String(error))).join(' | ')),
          });
          return { apiName: api.name, music, quality: hit.quality, url: hit.url };
        } catch (error) {
          outcomes[index] = `${api.name} 全部音质失败:${error instanceof Error ? error.message : String(error)}`;
          throw new Error(outcomes[index]);
        }
      })());

      try {
        const hit = await raceStaggeredPriority(launchers, {
          getQuality: (value) => value.quality,
          floor: floorQuality,
          ceiling: qualities[0],
          staggerMs: DEFAULT_SOURCE_STAGGER_MS,
          maxSpreadMs: CUSTOM_SOURCE_SPREAD_MS,
          upgradeWindowMs: DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
          deadlineMs: remaining,
          formatError: (errors) =>
            new Error(errors.map((error) => (error instanceof Error ? error.message : String(error))).join(';')),
        });
        operation.assertActive();
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
        // 生命周期失效时抛出生命周期错误,而不是被聚合成解析失败。
        operation.assertActive();
        const detail = outcomes.filter((item): item is string => Boolean(item)).join(';');
        failures.push(detail || (error instanceof Error ? error.message : String(error)));
      }
    }

    const detail = failures.join(' | ');
    const capped = detail.length > 500 ? `${detail.slice(0, 500)}...` : detail;
    throw new Error(`所有自定义音源都未解析到可播放链接:${capped}`);
  },
};

/** 自定义源阶段总预算:外层 14s deadline 内为探活与媒体缓存留余量。 */
const CUSTOM_SOURCE_TOTAL_BUDGET_MS = 10000;

/** 交错启动总展开上限:7 个源全部展开不超过该值(实测队尾慢源场景的关键)。 */
const CUSTOM_SOURCE_SPREAD_MS = 1600;

/** 剩余时间不足该值时不再启动新变体尝试,避免刚启动就撞外层 deadline。 */
const CUSTOM_SOURCE_MIN_ATTEMPT_MS = 1000;
