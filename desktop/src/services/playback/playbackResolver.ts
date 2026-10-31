import type { MusicInfo } from '@lx/core';
import { buildPlaybackQualityTiers, DEFAULT_QUALITY_UPGRADE_WINDOW_MS, getPlaybackQualityFallbacks, getPlaybackQualityRank, normalizePlaybackQuality, raceForBestQuality } from '@lx/core';
import { debugLog, loadSettings } from '@lx/tauri-bridge';
import { estimateStreamDurationSeconds, isPreviewStream } from '@lx/core';
import { builtinNeteaseBackend } from './builtinNeteaseBackend';
import { builtinProviderBackend } from './builtinProviderBackend';
import { customSourceBackend } from './customSourceBackend';
import { isVipOfficialFirst } from './officialPriority';
import { resolveHiddenFromGroups, startHiddenSearch, type HiddenCandidateGroup } from './hiddenFallbackService';
import { probeStreamUrl, PROBE_TIMEOUT_MS, type StreamProbeResult } from './streamProbe';
import type { PlaybackBackendId, PlaybackResolvedUrl } from './types';
import { getSource } from '@/services/sources/sourceService';
import { canResolveWithBuiltinMusicApi } from '@/services/builtinMusicApiModel';
import { getCachedPlaybackUrl, invalidateCachedPlaybackUrl, isLocalCachedPlaybackUrl, saveCachedPlaybackUrl } from '@/services/persistentCache';
import { cacheResolvedPlaybackMedia, findCachedPlaybackMedia, StalePlaybackCacheError } from '@/services/mediaCache';
import { customSourceAccess, customSourcePersistence, useCustomSourceStore } from '@/stores/customSourceStore';
import { CustomSourceDisabledError, type CustomSourceOperation } from '@/services/customSourceAccess';

export async function resolvePlaybackUrl(
  music: MusicInfo,
  variants?: MusicInfo[],
  preferredQuality?: string,
  options: ResolvePlaybackOptions = {},
): Promise<PlaybackResolvedUrl> {
  // 解析链总预算:竞速 + 慢源回退(实测第三方源 2-10s)后仍需在预算内留出
  // 探活与媒体缓存的时间;14s 内未出结果直接抛错走错误分支,不再无限等。
  if (!useCustomSourceStore.getState().featureReady) await customSourcePersistence.ready;
  const operation = useCustomSourceStore.getState().featureEnabled ? customSourceAccess.capture() : undefined;
  const deadlineAt = Date.now() + PLAYBACK_RESOLVE_TOTAL_BUDGET_MS;
  const resolved = await withResolveDeadline(
    resolvePlaybackUrlUncapped(music, variants, preferredQuality, options, operation, deadlineAt),
  );
  getCustomSourceOperation(resolved, operation);
  return resolved;
}

const PLAYBACK_RESOLVE_TOTAL_BUDGET_MS = 14_000;

export interface ResolvePlaybackOptions {
  bypassCache?: boolean;
  cacheMedia?: boolean;
  /**
   * 只解析所选音质，不参与逐档下调。
   *
   * 播放允许「先拿低档出声、再升级」，下载不行：用户选 flac 却下到 320k，
   * 文件名和库里的音质标签都与实际内容不符，且没有任何提示。
   * 开启后降级链与缓存查询都收敛为这一档。
   */
  exactQuality?: boolean;
}

/** 探活最多用剩余预算，且不低于 500ms：避免总超时后还新起一个 5s 探活。 */
function probeBudgetMs(deadlineAt: number): number {
  return Math.max(500, Math.min(PROBE_TIMEOUT_MS, deadlineAt - Date.now()));
}

/**
 * 远端签名地址的真实有效期通常远短于 6h TTL（实测网易云在 20 分钟量级）。
 * 命中一条超过该时长的远端条目时先做一次 1 字节 Range 探活：服务端明确拒绝
 * 就作废重解析，而不是把死链交给播放器（后者只会报错，用户还得再点一次）。
 *
 * 只对「没有落盘音频」的条目生效——本地文件由媒体缓存直接命中，不产生网络请求。
 */
const CACHED_URL_REVALIDATE_AFTER_MS = 10 * 60 * 1000;
/** 缓存地址的探活只值一次 1 字节请求：超过 2s 就当「下不了结论」，不能把起播拖住。 */
const CACHED_URL_REVALIDATE_TIMEOUT_MS = 2_000;

function shouldRevalidateCachedUrl(cached: PlaybackResolvedUrl): boolean {
  if (!cached.cachedAt || isLocalCachedPlaybackUrl(cached.url)) return false;
  return Date.now() - cached.cachedAt >= CACHED_URL_REVALIDATE_AFTER_MS;
}

/**
 * 胜出地址探活被明确拒绝后，尝试同一轮竞速里已结算的其它候选。
 *
 * 只在这一个源/档位失败时使用，不跨轮次。候选已按「音质降序 → 源序升序」
 * 排好，逐个探活取第一个确定可用的；超时 / 5xx 这类下不了结论的先记着，
 * 等全部确定失败再兜底放行——与单候选时的宽容语义保持一致，不能因为
 * 探活不确定就否掉一个可能完全正常的地址。
 */
async function pickPlayableFallback(
  current: PlaybackResolvedUrl,
  deadlineAt: number,
): Promise<{ resolved: PlaybackResolvedUrl; probe: StreamProbeResult } | null> {
  let tolerated: { resolved: PlaybackResolvedUrl; probe: StreamProbeResult } | null = null;
  for (const candidate of current.fallbacks ?? []) {
    // 每次回退都要吃一个探活 RTT，预算不够时不要为了兜底把整首拖死。
    if (deadlineAt - Date.now() <= 1_000) break;
    const probe = await probeStreamUrl(
      candidate.url,
      buildStreamHeaders(candidate.music.source),
      probeBudgetMs(deadlineAt),
    );
    if (probe.ok) return { resolved: candidate, probe };
    if (!probe.definitive && !tolerated) tolerated = { resolved: candidate, probe };
  }
  return tolerated;
}

const STREAM_REFERERS: Record<string, string> = {
  wy: 'https://music.163.com',
  tx: 'https://y.qq.com',
};

/** 与移动端 buildStreamHeaders 同语义:wy/tx CDN 防盗链头。 */
export function buildStreamHeaders(source: string | undefined): Record<string, string> | undefined {
  const referer = source ? STREAM_REFERERS[source] : undefined;
  if (!referer) return undefined;
  return { Referer: referer };
}

function withResolveDeadline(task: Promise<PlaybackResolvedUrl>): Promise<PlaybackResolvedUrl> {
  return new Promise<PlaybackResolvedUrl>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`播放地址解析超时(${PLAYBACK_RESOLVE_TOTAL_BUDGET_MS / 1000}s),请重试或切换音源`));
    }, PLAYBACK_RESOLVE_TOTAL_BUDGET_MS);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 主源=内置音乐 API;自定义源是懒唤醒的兜底,不默认参与每首歌的竞速。 */
const PRIMARY_BUDGET_MS = 2500;

type RacingBackendId = Exclude<PlaybackBackendId, 'hiddenSource'>;

function getBackend(id: RacingBackendId): { id: RacingBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> } {
  const table: Record<RacingBackendId, { id: RacingBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> }> = {
    builtinNetease: { id: 'builtinNetease', resolve: (request) => builtinNeteaseBackend.resolve(request) },
    customSource: { id: 'customSource', resolve: (request) => customSourceBackend.resolve(request) },
    builtinProvider: { id: 'builtinProvider', resolve: (request) => builtinProviderBackend.resolve(request) },
  };
  return table[id];
}

/** 把任意抛出物压成可展示的一行原因。 */
function formatReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error == null) return '未返回结果';
  return String(error);
}

/**
 * 等待 `task` 最多 `budgetMs`；超时返回 null，但**不取消** task。
 * 主源请求常常只是冷启动慢（实测网关 1.8-2.6s），超时后放弃这条在途响应
 * 再重发一次，等于既丢结果又翻倍请求量。
 */
function resolveWithBudget(
  task: Promise<PlaybackResolvedUrl | null>,
  budgetMs: number,
): Promise<PlaybackResolvedUrl | null> {
  return new Promise<PlaybackResolvedUrl | null>((resolve) => {
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

/**
 * 懒切竞速:主源(内置音乐 API)先单独跑 PRIMARY_BUDGET_MS。
 *  - 预算内成功且音质达到本轮期望 → 直接用,自定义源零唤醒;
 *  - 主源失败 / 超时 / 音质不足本轮期望 → 并行唤醒自定义源一起竞速,
 *    二者谁能拿到本轮更高音质用谁(仍是音质优先,不是先到先得)。
 *
 * 自定义源由 getCustomAttempt 惰性提供:调用方按「完整降级链」只发起一次竞速并在
 * 轮次间复用。旧实现每轮次重新唤醒一遍全部音源,tx 场景下第一轮(无损)烧完 8s
 * 预算失败后第二轮(320k)才从零开始——实测 320k 只需 2-7s 即可得,却被轮次
 * 序列推到总 deadline 之后,用户侧永远失败。
 */
async function raceQualityTierLazy(
  primary: { id: PlaybackBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> },
  getCustomAttempt: () => Promise<PlaybackResolvedUrl>,
  request: import('./types').PlaybackRequest,
  operation?: CustomSourceOperation,
): Promise<PlaybackResolvedUrl> {
  const targetRank = getPlaybackQualityRank(request.qualityPreference[0]);

  // 第一步:只跑主源,带预算。主源请求只发一次——预算耗尽只代表「等不及」,
  // 那条在途请求之后仍可能返回可用结果，所以下面复用它而不是重发。
  let primaryError: unknown;
  const primaryAttempt = primary.resolve(request).then(
    (value) => value,
    (error: unknown) => {
      primaryError = error;
      return null;
    },
  );
  const primaryHit = await resolveWithBudget(primaryAttempt, PRIMARY_BUDGET_MS);
  if (primaryHit && getPlaybackQualityRank(primaryHit.quality) >= targetRank) {
    return primaryHit;
  }

  // 禁用或本次解析所属生命周期已失效时，LX 根本不进入候选集。
  if (!operation?.isActive()) {
    if (primaryHit) return primaryHit;
    // 没有自定义源可唤醒：等这条在途请求收尾（受 request.deadlineAt 约束），
    // 不重发。旧实现在这里立刻再发一个一模一样的请求且无预算，对限流网关
    // 是纯放大；而且那个重发与在途请求争同一个配额，反而更容易一起超时。
    const late = await primaryAttempt;
    if (late) return late;
    throw new Error(`${primary.id}: ${formatReason(primaryError)}`);
  }

  // 第二步:主源不足(失败 / 超时 / 音质低于本轮期望),唤醒自定义源一起竞速取高音质。
  // 主源若已命中只是音质不足,直接带上它;未命中则继续等那条在途请求,
  // 而不是重发——同一首歌不再向主源发第二次请求。
  const primaryCandidate = primaryHit
    ? Promise.resolve(primaryHit)
    : primaryAttempt.then((value) => {
        if (value) return value;
        throw new Error(`${primary.id}: ${formatReason(primaryError)}`);
      });
  const customAttempt = getCustomAttempt();

  return raceForBestQuality([primaryCandidate, customAttempt], {
    getQuality: (resolved) => resolved.quality,
    upgradeWindowMs: DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
    // 本轮最高档命中即定稿,不再等窗口
    ceiling: request.qualityPreference[0],
    formatError: (errors) => {
      const detail = errors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join('\n');
      return new Error(`该音质档位全部解析失败\n${detail}`);
    },
  });
}

async function resolvePlaybackUrlUncapped(
  music: MusicInfo,
  variants?: MusicInfo[],
  preferredQuality?: string,
  options: ResolvePlaybackOptions = {},
  operation?: CustomSourceOperation,
  deadlineAt = Date.now() + PLAYBACK_RESOLVE_TOTAL_BUDGET_MS,
): Promise<PlaybackResolvedUrl> {
  const settings = await loadSettings();
  const qualityFloor = preferredQuality ?? settings.defaultQuality;
  // 分轮次:首轮是「不低于选定音质」的全部档位一起竞速,之后逐档下调。
  // exactQuality（下载）只保留用户选的那一档：缓存查询也不许命中其它档位，
  // 否则「选 flac 却命中 128k 缓存」会直接产出一个标错音质的文件。
  const qualityTiers = options.exactQuality
    ? [[normalizePlaybackQuality(qualityFloor)]]
    : buildPlaybackQualityTiers(qualityFloor);
  // 扁平降级链仅用于缓存查询与官方直连兜底,这两处不分轮次。
  const qualityPreference = options.exactQuality
    ? [normalizePlaybackQuality(qualityFloor)]
    : getPlaybackQualityFallbacks(qualityFloor);
  debugLog(`[resolve] 开始解析 ${music.source}/${music.name} id=${music.id} 音质轮次=${qualityTiers.map((tier) => tier.join('+')).join(' > ')}`);

  // 隐藏兜底分两段：搜索可以提前并行（纯 HTTP、无副作用），取链必须等到常规链路
  // 真的失败。两者分开是为了不让「1s 就解析成功」的歌白唤醒 LX 脚本、白跑一轮
  // musicUrl；同时搜索仍能提前启动，避免自定义源慢回退把预算烧完后才开始搜。
  let hiddenSearch: Promise<HiddenCandidateGroup[]> | null = null;
  const ensureHiddenSearch = (): Promise<HiddenCandidateGroup[]> => {
    if (!hiddenSearch) {
      hiddenSearch = startHiddenSearch(music, deadlineAt).catch((error) => {
        debugLog(`[resolve] 隐藏音源搜索失败: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      });
    }
    return hiddenSearch;
  };
  let hiddenResolve: Promise<PlaybackResolvedUrl | null> | null = null;
  const ensureHiddenResolve = (): Promise<PlaybackResolvedUrl | null> => {
    if (!hiddenResolve) {
      hiddenResolve = ensureHiddenSearch()
        .then((groups) => resolveHiddenFromGroups(groups, music, qualityPreference, deadlineAt, operation))
        .catch((error) => {
          debugLog(`[resolve] 隐藏兜底失败: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        });
    }
    return hiddenResolve;
  };

  const allVariants = variants?.length ? variants : [music];
  const cacheVariants = allVariants.some((item) => item.source === music.source && item.id === music.id)
    ? allVariants
    : [music, ...allVariants];

  // 第 0 层：已落盘的音频优先。音频文件活 365 天，持久化 URL 只活 6 小时——
  // URL 过期/被清理后仍应能离线播放，不能为了拿一个很快就会失效的签名地址
  // 把整条网络解析链重跑一遍（网络侧失败时表现就是「缓存过却播不了」）。
  // 下载（cacheMedia:false）、exactQuality 解析与显式 bypassCache（缓存地址播放失败后的
  // 重解析）都必须绕开本地文件：前两者要远端直链，后者要摆脱刚刚失败的同一份缓存。
  if (!options.bypassCache && options.cacheMedia !== false && !options.exactQuality && music.source !== 'local') {
    for (const candidate of cacheVariants) {
      let local: PlaybackResolvedUrl | null = null;
      try {
        local = await findCachedPlaybackMedia(candidate, qualityPreference, operation);
      } catch (error) {
        debugLog(`[resolve] 本地音频缓存查询失败，按未命中处理: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (local) {
        debugLog(
          `[resolve] 命中本地音频缓存 ${candidate.name} quality=${local.quality} backend=${local.backend}`,
        );
        return local;
      }
    }
  }

  if (!options.bypassCache) {
    try {
      const cached = await getCachedPlaybackUrl(music, qualityPreference, cacheVariants);
      // 持久化条目存的可能是会过期的远端地址、也可能是指向已被淘汰的本地文件的死链；
      // 这里再过一次媒体缓存：远端地址在音频已落盘时升级为本地文件，
      // 本地条目不可用时抛 StalePlaybackCacheError，由下面作废该条目并改为重新解析。
      if (cached) {
        // 老条目（超过 10 分钟）先做一次廉价探活：签名地址过期时直接重解析，
        // 避免把死链抛给播放器后用户只看到「播放失败」。
        let usable = true;
        if (shouldRevalidateCachedUrl(cached)) {
          const revalidate = await probeStreamUrl(
            cached.url,
            buildStreamHeaders(cached.music.source),
            Math.min(probeBudgetMs(deadlineAt), CACHED_URL_REVALIDATE_TIMEOUT_MS),
          );
          if (!revalidate.ok && revalidate.definitive) {
            usable = false;
            debugLog(
              `[resolve] 持久化地址已失效（${revalidate.reason}），作废后重新解析: ${music.name}`,
            );
            await Promise.all([
              invalidateCachedPlaybackUrl(music, cached.quality).catch(() => undefined),
              invalidateCachedPlaybackUrl(cached.music, cached.quality).catch(() => undefined),
            ]);
            operation?.assertActive();
          }
        }
        if (usable) {
          debugLog(`[resolve] 命中持久化缓存 ${music.name} url=${cached.url.slice(0, 60)}`);
          try {
            return await prepareResolvedPlaybackMedia(music, cached, options.cacheMedia !== false, operation);
          } catch (error) {
            if (!(error instanceof StalePlaybackCacheError)) throw error;
            // 只作废这一条音质档（主源与变体都可能存过同一条），其余档位的记录不受影响。
            debugLog(
              `[resolve] 持久化条目指向的本地文件已不可用（${error.message}），作废后重新解析: ${music.name}`,
            );
            await Promise.all([
              invalidateCachedPlaybackUrl(music, cached.quality).catch(() => undefined),
              invalidateCachedPlaybackUrl(cached.music, cached.quality).catch(() => undefined),
            ]);
            operation?.assertActive();
          }
        }
      }
    } catch (error) {
      // 缓存读失败按未命中处理，继续走网络解析；但不能完全静默，
      // 否则缓存文件损坏/权限异常会退化成"每次都重新解析"而无任何线索。
      debugLog(`[resolve] 读取持久化缓存失败，按未命中处理: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 云盘曲：直接走官方直连，不参与任何竞速，也不做试听判定。
  //
  // 为什么短路编排：云盘文件不在任何第三方源里。内置网关因缺 `gateway` 元数据
  // 必然抛「无该歌曲的解析元数据」，自定义源脚本也只会白跑一轮（最多 1600ms
  // 交错展开 + 10s 阶段预算）。而官方直连的 weapi 接口带 Cookie 就能拿到账号
  // 自己的文件（实测账号内 161 条全部取链成功），所以这两层对云盘曲纯属浪费。
  //
  // 为什么跳过试听判定：`isPreviewStream` 用「请求档位的标称码率」估算时长，
  // 而云盘返回的是原文件码率。128k 的 3.4MB / 223s 上传，在 flac 档会被估算成
  // 32s（低于 60s 阈值），误判成 30s 试听并导致整档作废、报出误导性的
  // 「解析到试听片段(约 32s)」。云盘文件是账号自己的完整文件，这一层不适用。
  //
  // 音质标签仍沿用请求档位而不是文件真实码率：持久化缓存的 key、降级链查询都按
  // 标签匹配，标成真实码率（例如把 320k 的请求标成 flac）反而永远命中不了缓存，
  // 变成每播一次就重新解析。真实码率由 UI 从 music.cloudMeta.bitrate 单独展示。
  if (music.wyCloud === true) {
    const resolved = await builtinProviderBackend.resolve({
      primary: music,
      variants: allVariants,
      qualityPreference,
      deadlineAt,
    });
    debugLog(`[resolve] 云盘曲官方直连 ${music.name} url=${resolved.url.slice(0, 60)}`);
    const playable = await prepareResolvedPlaybackMedia(
      music,
      resolved,
      options.cacheMedia !== false,
      operation,
    );
    void saveCachedPlaybackUrl(music, playable, Date.now(), operation).catch((error) => {
      debugLog(`[resolve] 播放地址缓存未提交: ${error instanceof Error ? error.message : String(error)}`);
    });
    return playable;
  }
  // 懒切编排(对齐移动端 playerService):
  // 每轮先只跑内置音乐 API(主源),2.5s 内给出「达标音质」即定稿,自定义源零唤醒;
  // 主源失败 / 超时 / 音质不足本轮期望时才并行唤醒自定义源一起竞速兜底。
  //
  // 隐藏兜底从这里开始并行搜索：缓存未命中且所有变体都没有网关元数据的在线曲
  // （典型：QQ 官方搜索的 tx 曲）主源必然快速失败，提前搜索酷我/酷狗，避免
  // 自定义源慢回退把 10s 预算烧完后才轮到隐藏平台。只搜不取链。
  // 预取（cacheMedia === false）不提前启动：一次预取多首会同时拉起多条搜索，
  // 即使常规链路成功也全部白跑；预取只在真正失败时再启动。
  const shouldStartHiddenEarly =
    options.cacheMedia !== false &&
    music.source !== 'local' &&
    !allVariants.some(canResolveWithBuiltinMusicApi);
  if (shouldStartHiddenEarly) {
    void ensureHiddenSearch();
  }
  const tierErrors: string[] = [];
  // 会员会话：官方直连（weapi + Cookie）直接作为主源。网关对 VIP 曲目只能给降档/试听，
  // 而会员的账号权限本身就是最高音质的来源；官方失败时 raceQualityTierLazy 仍会照常
  // 唤醒自定义源并降档重试，所以这里只是把「最可靠的那条」提前，不改变兜底语义。
  // 非会员保持原样：官方直连对无权限曲目会返回 30s 试听，先跑它只会多花一轮预算。
  const preferOfficial = music.source === 'wy' && isVipOfficialFirst();
  const builtinPrimary = getBackend(preferOfficial ? 'builtinProvider' : 'builtinNetease');
  if (preferOfficial) {
    debugLog(`[resolve] 会员直连优先：${music.name} 先走官方接口，网关/自定义源仅作兜底`);
  }
  const customBackend = getBackend('customSource');
  // 自定义源按完整降级链只竞速一次,轮次间复用同一 promise:
  // 音质轮次只约束内置主源(每轮单档、逐档下调);自定义源自身的交错竞速已按
  // 「档位顺序=优先权、整链一起竞速」在链内择优,轮次层再重复唤醒只会把队尾
  // 慢源(实测 HYW 排第 6、7 位,是 tx 唯一可用源)反复推后,被总 deadline 绞杀。
  let customAttemptPromise: Promise<PlaybackResolvedUrl> | null = null;
  const getCustomAttempt = (): Promise<PlaybackResolvedUrl> => {
    if (!customAttemptPromise) {
      customAttemptPromise = customBackend.resolve({
        primary: music,
        variants: allVariants,
        qualityPreference,
        deadlineAt,
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${customBackend.id}: ${message}`);
      });
    }
    return customAttemptPromise;
  };
  for (const tier of qualityTiers) {
    const request: import('./types').PlaybackRequest = {
      primary: music,
      variants: allVariants,
      qualityPreference: tier,
      deadlineAt,
    };
    try {
      let resolved = await raceQualityTierLazy(builtinPrimary, getCustomAttempt, request, operation);
      getCustomSourceOperation(resolved, operation);
      // 本轮可接受的最低档是 tier 的最后一个元素（首轮是「不低于选定音质」的
      // 全部档位，最后一个是用户门槛；后续轮次只有一个档）。
      // 低于它说明是自定义源提前拿到的降档结果：不能在这里定稿，
      // 否则用户选 flac、主源慢时会被 128k 直接截胡，后面的轮次再也不跑。
      const tierFloorRank = getPlaybackQualityRank(tier[tier.length - 1]);
      if (getPlaybackQualityRank(resolved.quality) < tierFloorRank) {
        debugLog(
          `[resolve] ${music.name} 轮=${tier.join('+')} 命中 ${resolved.quality} 低于本轮门槛，继续下一轮`,
        );
        void ensureHiddenResolve();
        continue;
      }
      debugLog(`[resolve] 命中 ${music.name} 轮=${tier.join('+')} 命中=${resolved.quality} backend=${resolved.backend} url=${resolved.url.slice(0, 60)}`);
      // 试听片段判定(与移动端同语义,见 @lx/core stream-integrity):
      // 30s 试听与完整版同样返回 206,靠 Content-Range / Content-Length 估算流时长,
      // 明显短于期望时长(music.interval)则视为试听:不写缓存、不进播放器,降档重试。
      // 探活必须带「实际解析到的变体」的 Referer：wy 主源可能解析到 tx 变体，
      // 用主源 Referer 会被 QQ CDN 判 403，把可用地址误杀。
      const probeHeaders = buildStreamHeaders(resolved.music.source);
      let probe = await probeStreamUrl(resolved.url, probeHeaders, probeBudgetMs(deadlineAt));
      if (!probe.ok && probe.definitive) {
        // 胜出地址被服务端明确拒绝（403/404/410/451）。同一轮竞速里往往已经有
        // 别的源/档位结算出可用地址——先按「音质降序 → 源序」回退；整轮都没
        // 可用才丢这一轮进下一档，否则这轮所有结果都白跑了。
        const rejectedReason = probe.reason;
        const fallback = await pickPlayableFallback(resolved, deadlineAt);
        if (!fallback) {
          tierErrors.push(`探活失败(${rejectedReason})`);
          continue;
        }
        resolved = fallback.resolved;
        probe = fallback.probe;
        debugLog(
          `[resolve] ${music.name} 胜出地址${rejectedReason}，回退到同轮候选 ${resolved.quality}/${resolved.resolverName}`,
        );
      }
      if (!probe.ok) {
        // 超时 / 网络抖动 / 5xx / 响应体超限都下不了结论。不能因为探活不确定就否掉
        // 一个可能完全正常的地址：部分 CDN 忽略 Range 或对大文件响应慢，旧逻辑会让
        // 高音质档位整体阵亡并静默降级。放行播放，由播放器错误回调兜底。
        debugLog(`[resolve] ${music.name} 轮=${tier.join('+')} 探活无结论，仍采用该地址: ${probe.reason}`);
      } else if (
        probe.totalBytes != null &&
        isPreviewStream({
          totalBytes: probe.totalBytes,
          quality: resolved.quality,
          expectedDurationSeconds: music.interval,
        })
      ) {
        const previewSeconds = estimateStreamDurationSeconds(probe.totalBytes, resolved.quality);
        tierErrors.push(`解析到试听片段(约 ${Math.round(previewSeconds ?? 0)}s)`);
        continue;
      }
      const playable = await prepareResolvedPlaybackMedia(music, resolved, options.cacheMedia !== false, operation);
      void saveCachedPlaybackUrl(music, playable, Date.now(), operation).catch((error) => {
        debugLog(`[resolve] 播放地址缓存未提交: ${error instanceof Error ? error.message : String(error)}`);
      });
      return playable;
    } catch (error) {
      tierErrors.push(error instanceof Error ? error.message : String(error));
      void ensureHiddenResolve();
    }
  }

  // 懒切全败后的最后保险:wy/tx 官方直连 provider。不参与竞速(对齐移动端),
  // 但网关整条挂掉时不至于整首失败
  if (getSource(music.source)) {
    try {
      const resolved = await builtinProviderBackend.resolve({
        primary: music,
        variants: allVariants,
        qualityPreference,
        deadlineAt,
      });
      debugLog(`[resolve] 官方直连兜底成功 ${music.name} url=${resolved.url.slice(0, 60)}`);
      // 官方直连兜底同样要过试听判定：wy eapi 无 VIP 正是返回 30s 试听的场景
      // （见 @lx/core stream-integrity 的说明），而这条路径不参与竞速、此前完全没做判定。
      // 判定为试听则按失败处理，与档位循环的「试听即作废、不写缓存、不进播放器」语义一致。
      const fallbackProbe = await probeStreamUrl(
        resolved.url,
        buildStreamHeaders(resolved.music.source),
        probeBudgetMs(deadlineAt),
      );
      if (
        fallbackProbe.ok &&
        fallbackProbe.totalBytes != null &&
        isPreviewStream({
          totalBytes: fallbackProbe.totalBytes,
          quality: resolved.quality,
          expectedDurationSeconds: music.interval,
        })
      ) {
        const previewSeconds = estimateStreamDurationSeconds(fallbackProbe.totalBytes, resolved.quality);
        tierErrors.push(`官方直连兜底解析到试听片段(约 ${Math.round(previewSeconds ?? 0)}s)`);
      } else {
        const playable = await prepareResolvedPlaybackMedia(music, resolved, options.cacheMedia !== false, operation);
        void saveCachedPlaybackUrl(music, playable, Date.now(), operation).catch((error) => {
          debugLog(`[resolve] 播放地址缓存未提交: ${error instanceof Error ? error.message : String(error)}`);
        });
        return playable;
      }
    } catch (error) {
      tierErrors.push(`内置音源(官方直连兜底): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 常规链路全败后的隐藏兜底：酷我/酷狗搜索同名曲目，交给已装 LX 脚本取链。
  // 隐藏音源 URL 来自第三方平台 CDN，不带 wy/tx 的 Referer；探活语义与官方直连兜底一致：
  // 服务端明确拒绝才放弃，超时/抖动下不了结论时仍采用地址，由播放器错误回调兜底。
  const hidden = await ensureHiddenResolve();
  if (hidden) {
    const hiddenProbe = await probeStreamUrl(hidden.url, undefined, probeBudgetMs(deadlineAt));
    if (!hiddenProbe.ok && hiddenProbe.definitive) {
      tierErrors.push(`隐藏音源兜底探活失败(${hiddenProbe.reason})`);
    } else if (
      hiddenProbe.ok &&
      hiddenProbe.totalBytes != null &&
      isPreviewStream({
        totalBytes: hiddenProbe.totalBytes,
        quality: hidden.quality,
        expectedDurationSeconds: music.interval,
      })
    ) {
      const previewSeconds = estimateStreamDurationSeconds(hiddenProbe.totalBytes, hidden.quality);
      tierErrors.push(`隐藏音源兜底解析到试听片段(约 ${Math.round(previewSeconds ?? 0)}s)`);
    } else {
      debugLog(
        `[resolve] 隐藏音源兜底成功 ${music.name} backend=${hidden.backend} quality=${hidden.quality} url=${hidden.url.slice(0, 60)}`,
      );
      const playable = await prepareResolvedPlaybackMedia(music, hidden, options.cacheMedia !== false, operation);
      void saveCachedPlaybackUrl(music, playable, Date.now(), operation).catch((error) => {
        debugLog(`[resolve] 播放地址缓存未提交: ${error instanceof Error ? error.message : String(error)}`);
      });
      return playable;
    }
  }

  const message = `播放地址解析失败(已尝试 ${qualityPreference.join(' → ')} 档):\n${tierErrors.join('\n')}`;
  debugLog(`[resolve] 全部失败 ${music.source}/${music.name}\n${message}`);
  throw new Error(message);
}

function getCustomSourceOperation(
  resolved: PlaybackResolvedUrl,
  operation?: CustomSourceOperation,
): CustomSourceOperation | undefined {
  // 隐藏兜底同样经 LX 脚本取链，生命周期判定与自定义音源一致。
  if (resolved.backend !== 'customSource' && resolved.backend !== 'hiddenSource') return undefined;
  if (!operation) throw new CustomSourceDisabledError();
  operation.assertActive();
  return operation;
}

async function prepareResolvedPlaybackMedia(
  primary: MusicInfo,
  resolved: PlaybackResolvedUrl,
  cacheMedia: boolean,
  operation?: CustomSourceOperation,
): Promise<PlaybackResolvedUrl> {
  const access = getCustomSourceOperation(resolved, operation);
  if (!cacheMedia) return resolved;
  try {
    const cached = await cacheResolvedPlaybackMedia(primary, resolved, access);
    access?.assertActive();
    return cached;
  } catch (error) {
    // 生命周期失效不能被媒体缓存的网络失败回退吞掉。
    access?.assertActive();
    // 本地缓存条目已作废（文件被 LRU 淘汰 / 老命名 / 落盘的是试听片段）：
    // 回退到原地址只会把死链交给播放器（asset 协议 404 → 立刻失败，开了自动下一首就跳歌），
    // 必须抛给调用方去作废持久化条目并重新解析。
    if (error instanceof StalePlaybackCacheError) throw error;
    // 媒体缓存（封面/音频落盘）失败不影响本次播放，仍用远端地址；
    // 但要留痕，否则“缓存一直不命中”会没人发现。
    debugLog(`[resolve] 媒体缓存处理失败，改用原地址: ${error instanceof Error ? error.message : String(error)}`);
    return resolved;
  }
}

export type { PlaybackBackendId, PlaybackResolvedUrl };
