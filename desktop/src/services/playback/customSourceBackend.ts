import {
  createRequestLimiter,
  DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
  DEFAULT_SOURCE_STAGGER_MS,
  getPlaybackQualityRank,
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
    const enabledSources = useCustomSourceStore.getState().sources.filter((source) => source.enabled);
    if (!enabledSources.length) {
      throw new Error('当前备用播放方式为自定义音源,但尚未导入或启用任何 LX Music 自定义音源');
    }

    const variants = request.variants?.length ? request.variants : [request.primary];
    const qualities = request.qualityPreference;
    if (!qualities.length) throw new Error('没有可尝试的音质档位');
    const floorQuality = qualities[qualities.length - 1];
    const trace: PlaybackAttempt[] = [];
    // 自定义源不独占总预算：外层 deadline 之前还要留出探活与媒体缓存的时间。
    // 之前固定 10s 会把 2.5s 主源 + 10s 自定义源 + 5s 探活叠加到 17.5s，超过 14s。
    const availableBudget = request.deadlineAt
      ? request.deadlineAt - Date.now() - CUSTOM_SOURCE_PROBE_RESERVE_MS
      : CUSTOM_SOURCE_TOTAL_BUDGET_MS;
    const budget = Math.min(CUSTOM_SOURCE_TOTAL_BUDGET_MS, availableBudget);
    if (budget <= CUSTOM_SOURCE_MIN_ATTEMPT_MS) {
      throw new Error('播放解析总预算不足，未尝试自定义音源');
    }
    const budgetEndsAt = Date.now() + budget;
    const failures: string[] = [];

    for (const music of variants) {
      const remaining = budgetEndsAt - Date.now();
      if (remaining <= CUSTOM_SOURCE_MIN_ATTEMPT_MS) {
        failures.push(`时间预算耗尽,未尝试变体 ${music.name}`);
        break;
      }

      // 本轮所有已结算的成功结果（包括没有胜出的）。胜出地址探活被 CDN 明确
      // 拒绝时，外层按音质/源序回退到这些候选，而不是丢掉整轮重新解析。
      const collected: Array<CustomSourceHit & { rank: number; sourceIndex: number }> = [];
      // 竞速是「源 × 音质」二维展开，最坏会同时打出 20+ 个远程请求；对第三方
      // 公益代理是明显的放大，被限流后所有源一起变慢，竞速会退化成一起超时。
      // 这里把在途压到 3 个，超出的候选排队；本轮一结束就 abandon，排队中的
      // 候选直接作废，一个字节都不会在「已经有结果」之后补发出去。
      const limiter = createRequestLimiter({ limit: MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS });

      // 有 sources 元数据时先按平台过滤：没有声明 musicUrl 的源不必执行脚本再失败。
      // 元数据缺失（从未测试/初始化）的源保持参与，运行时仍会做最终校验。
      const customSources = enabledSources.filter((api) => {
        const info = api.sources?.[music.source];
        return !info || info.actions.includes('musicUrl');
      });
      if (!customSources.length) {
        failures.push(`${music.source} 没有声明支持 musicUrl 的自定义音源`);
        continue;
      }

      // 每个源:源内部也走同一个交错竞速——最高档先发,未回就在交错期后并发降档;
      // 首个达标结果开启升级窗口,最高档在窗口内赶上仍可翻盘。
      // 旧实现按档位串行等待:服务端对高清单走慢回退路径(实测 flac24bit 18.7s 才回
      // 320k 兜底,而 flac 只要 2.1s)时,整源被拖死,真正可用的档位从未被请求。
      const outcomes = customSources.map<string | undefined>(() => undefined);
      const launchers = customSources.map((api, index) => () => (async (): Promise<CustomSourceHit> => {
        operation.assertActive();
        // 按脚本声明的音质预过滤（与隐藏音源 pickQualities 同语义）。
        // 不声明时保持全部档位参与；声明了却一个都不匹配就直接判该源失败，
        // 而不是把整条降级链都发过去、等运行时再抛「音源不支持 xx 音质」白跑一轮。
        const declared = api.sources?.[music.source]?.qualitys ?? [];
        const sourceQualities = declared.length
          ? qualities.filter((quality) => declared.includes(quality))
          : qualities;
        if (sourceQualities.length === 0) {
          outcomes[index] = `${api.name} 未声明支持 ${qualities.join('/')} 中的任何音质`;
          throw new Error(outcomes[index]);
        }
        const qualityLaunchers = sourceQualities.map((requested) => () => (async () => {
          operation.assertActive();
          // 排队期间本轮可能已经定稿，acquire 会直接抛错，一个请求都不发。
          const releaseSlot = await limiter.acquire();
          try {
            // 运行时上浮:正常播放取链期间脚本 send updateAlert 且无 waiter 等待时回调,
            // 写入 store 让全局更新弹窗(updateStatus === 'available')能感知;
            // 手动测试/检查更新路径走 waitForUpdateAlert 自行消费,不会重复上报
            const result = await requestCustomSourceMusicUrl(api, music, requested, operation, (alert) => {
              operation.assertActive();
              useCustomSourceStore.getState().applyRuntimeUpdateAlert(api.id, alert);
            });
            operation.assertActive();
            const hit: CustomSourceHit = {
              apiName: api.name,
              music,
              quality: normalizePlaybackQuality(result.quality || requested),
              url: result.url,
            };
            collected.push({ ...hit, rank: getPlaybackQualityRank(hit.quality), sourceIndex: index });
            return hit;
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
          } finally {
            releaseSlot();
          }
        })());
        try {
          const hit = await raceStaggeredPriority(qualityLaunchers, {
            getQuality: (value) => value.quality,
            // 门槛取该源实际可用的最低档：声明 flac-only 的源不该因为「不到 320k」被否，
            // 它给的就是它能给的最高音质。
            floor: sourceQualities[sourceQualities.length - 1],
            ceiling: sourceQualities[0],
            staggerMs: DEFAULT_SOURCE_STAGGER_MS,
            maxSpreadMs: CUSTOM_SOURCE_SPREAD_MS,
            upgradeWindowMs: DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
            // 源内竞速必须跟随本轮总预算。之前这里没设 deadline：外层到期
            // finish 之后，内层还在按交错间隔把剩下的音质一个个发出去，
            // 用户已经在听了，请求还在打。
            deadlineMs: Math.max(CUSTOM_SOURCE_MIN_ATTEMPT_MS, budgetEndsAt - Date.now()),
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
        const hit = await (async () => {
          try {
            return await raceStaggeredPriority(launchers, {
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
          } finally {
            // 定稿或失败后立刻关闸：排队中的候选不再发请求，在途的让它收尾。
            limiter.abandon();
          }
        })();
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
          fallbacks: buildFallbackCandidates(collected, hit),
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

/** 自定义源阶段最大预算。实际预算还会被外层 deadline 压缩。 */
const CUSTOM_SOURCE_TOTAL_BUDGET_MS = 10000;

/** 给探活与媒体缓存预留的时间：外层 14s 内自定义源最多用「剩余时间 - 该值」。 */
const CUSTOM_SOURCE_PROBE_RESERVE_MS = 6000;

/** 交错启动总展开上限:7 个源全部展开不超过该值(实测队尾慢源场景的关键)。 */
const CUSTOM_SOURCE_SPREAD_MS = 1600;

/** 剩余时间不足该值时不再启动新变体尝试,避免刚启动就撞外层 deadline。 */
const CUSTOM_SOURCE_MIN_ATTEMPT_MS = 1000;

/**
 * 同时在途的自定义源取链请求上限。
 *
 * 竞速是「源 × 音质」二维展开，8 个源 × 4 档在最坏情况下会同时打出 30 个请求。
 * 对自建源无所谓，但这几个源里常有第三方公益代理，被限流之后所有源一起变慢，
 * 竞速反而退化成「一起超时」。压到 3 个之后最坏请求量从乘积变成接近线性，
 * 代价是队尾候选要排队——租约与排队超时由 @lx/core 的闸门负责兜底。
 */
const MAX_INFLIGHT_CUSTOM_SOURCE_REQUESTS = 3;

/** 回退候选最多留几个：每次回退都要一次探活 RTT，不宜为兜底把整首拖死。 */
const MAX_FALLBACK_CANDIDATES = 2;

/**
 * 把本轮已结算但没胜出的候选整理成回退链（按音质降序 → 源序升序）。
 * 同一个 URL 被多个源/档位返回时只留第一次出现的那个。
 */
function buildFallbackCandidates(
  collected: Array<CustomSourceHit & { rank: number; sourceIndex: number }>,
  winner: CustomSourceHit,
): PlaybackResolvedUrl[] {
  const seen = new Set<string>([winner.url]);
  const fallbacks: PlaybackResolvedUrl[] = [];
  const ordered = [...collected].sort(
    (a, b) => b.rank - a.rank || a.sourceIndex - b.sourceIndex,
  );
  for (const item of ordered) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    fallbacks.push({
      url: item.url,
      music: item.music,
      quality: item.quality,
      backend: 'customSource',
      resolverName: item.apiName,
      trace: [],
    });
    if (fallbacks.length >= MAX_FALLBACK_CANDIDATES) break;
  }
  return fallbacks;
}
