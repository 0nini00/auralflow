import type { MusicInfo } from '@lx/core';
import { buildPlaybackQualityTiers, DEFAULT_QUALITY_UPGRADE_WINDOW_MS, getPlaybackQualityFallbacks, getPlaybackQualityRank, raceForBestQuality } from '@lx/core';
import { debugLog, loadSettings } from '@lx/tauri-bridge';
import { estimateStreamDurationSeconds, isPreviewStream } from '@lx/core';
import { builtinNeteaseBackend } from './builtinNeteaseBackend';
import { builtinProviderBackend } from './builtinProviderBackend';
import { customSourceBackend } from './customSourceBackend';
import { probeStreamUrl } from './streamProbe';
import type { PlaybackBackendId, PlaybackResolvedUrl } from './types';
import { getSource } from '@/services/sources/sourceService';
import { getCachedPlaybackUrl, saveCachedPlaybackUrl } from '@/services/persistentCache';
import { cacheResolvedPlaybackMedia } from '@/services/mediaCache';

export async function resolvePlaybackUrl(
  music: MusicInfo,
  variants?: MusicInfo[],
  preferredQuality?: string,
  options: { bypassCache?: boolean; cacheMedia?: boolean } = {},
): Promise<PlaybackResolvedUrl> {
  // 解析链总预算:并发竞速已大幅压缩最坏等待,但个别网关/音源脚本卡死时
  // 仍需兜底;12s 内未出结果直接抛错走错误分支,不再无限等。
  return withResolveDeadline(resolvePlaybackUrlUncapped(music, variants, preferredQuality, options));
}

const PLAYBACK_RESOLVE_TOTAL_BUDGET_MS = 12_000;

const STREAM_REFERERS: Record<string, string> = {
  wy: 'https://music.163.com',
  tx: 'https://y.qq.com',
};

/** 与移动端 buildStreamHeaders 同语义:wy/tx CDN 防盗链头。 */
function buildStreamHeaders(source: string | undefined): Record<string, string> | undefined {
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

function getBackend(id: PlaybackBackendId): { id: PlaybackBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> } {
  const table: Record<PlaybackBackendId, { id: PlaybackBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> }> = {
    builtinNetease: { id: 'builtinNetease', resolve: (request) => builtinNeteaseBackend.resolve(request) },
    customSource: { id: 'customSource', resolve: (request) => customSourceBackend.resolve(request) },
    builtinProvider: { id: 'builtinProvider', resolve: (request) => builtinProviderBackend.resolve(request) },
  };
  return table[id];
}

/** 让单个 backend 带预算地 resolve;超预算返回 null(不抛,由调用方决定是否唤醒兜底)。 */
async function resolveBackendWithBudget(
  backend: { id: PlaybackBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> },
  request: import('./types').PlaybackRequest,
  budgetMs: number,
): Promise<PlaybackResolvedUrl | null> {
  return new Promise<PlaybackResolvedUrl | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), budgetMs);
    backend.resolve(request).then(
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
 */
async function raceQualityTierLazy(
  primary: { id: PlaybackBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> },
  custom: { id: PlaybackBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> },
  request: import('./types').PlaybackRequest,
): Promise<PlaybackResolvedUrl> {
  const targetRank = getPlaybackQualityRank(request.qualityPreference[0]);

  // 第一步:只跑主源,带预算。
  const primaryHit = await resolveBackendWithBudget(primary, request, PRIMARY_BUDGET_MS);
  if (primaryHit && getPlaybackQualityRank(primaryHit.quality) >= targetRank) {
    return primaryHit;
  }

  // 第二步:主源不足(失败 / 超时 / 音质低于本轮期望),唤醒自定义源一起竞速取高音质。
  // 主源若已命中只是音质不足,直接带上它(避免同一首歌主源发两次请求);
  // 未命中(超时/失败)则重试一次,与自定义源并行。
  let primaryRetry: Promise<PlaybackResolvedUrl>;
  if (primaryHit) {
    primaryRetry = Promise.resolve(primaryHit);
  } else {
    primaryRetry = primary.resolve(request).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${primary.id}: ${message}`);
    });
  }
  const customAttempt = custom.resolve(request).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${custom.id}: ${message}`);
  });

  return raceForBestQuality([primaryRetry, customAttempt], {
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
  options: { bypassCache?: boolean; cacheMedia?: boolean } = {},
): Promise<PlaybackResolvedUrl> {
  const settings = await loadSettings();
  const qualityFloor = preferredQuality ?? settings.defaultQuality;
  // 分轮次:首轮是「不低于选定音质」的全部档位一起竞速,之后逐档下调。
  const qualityTiers = buildPlaybackQualityTiers(qualityFloor);
  // 扁平降级链仅用于缓存查询与官方直连兜底,这两处不分轮次。
  const qualityPreference = getPlaybackQualityFallbacks(qualityFloor);
  debugLog(`[resolve] 开始解析 ${music.source}/${music.name} id=${music.id} 音质轮次=${qualityTiers.map((tier) => tier.join('+')).join(' > ')}`);
  const allVariants = variants?.length ? variants : [music];
  const cacheVariants = allVariants.some((item) => item.source === music.source && item.id === music.id)
    ? allVariants
    : [music, ...allVariants];

  if (!options.bypassCache) {
    try {
      const cached = await getCachedPlaybackUrl(music, qualityPreference, cacheVariants);
      // 持久化条目存的可能是会过期的远端地址;再过一次媒体缓存,
      // 音频已落盘时升级为本地文件,避免命中过期 URL。
      if (cached) {
        debugLog(`[resolve] 命中持久化缓存 ${music.name} url=${cached.url.slice(0, 60)}`);
        return await prepareResolvedPlaybackMedia(music, cached, options.cacheMedia !== false);
      }
    } catch (error) {
      // 缓存读失败按未命中处理，继续走网络解析；但不能完全静默，
      // 否则缓存文件损坏/权限异常会退化成"每次都重新解析"而无任何线索。
      debugLog(`[resolve] 读取持久化缓存失败，按未命中处理: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // B 站解析无音质分层且接口链路较慢,提前单独解析,不进音质竞速。
  if (music.source === 'bili' && getSource(music.source)) {
    const resolved = await builtinProviderBackend.resolve({
      primary: music,
      variants: allVariants,
      qualityPreference,
    });
    debugLog(`[resolve] B站独立解析成功 ${music.name} url=${resolved.url.slice(0, 60)}`);
    const playable = await prepareResolvedPlaybackMedia(music, resolved, options.cacheMedia !== false);
    void saveCachedPlaybackUrl(music, playable).catch(() => undefined);
    return playable;
  }

  // 懒切编排(对齐移动端 playerService):
  // 每轮先只跑内置音乐 API(主源),2.5s 内给出「达标音质」即定稿,自定义源零唤醒;
  // 主源失败 / 超时 / 音质不足本轮期望时才并行唤醒自定义源一起竞速兜底。
  const tierErrors: string[] = [];
  const builtinPrimary = getBackend('builtinNetease');
  const customBackend = getBackend('customSource');
  for (const tier of qualityTiers) {
    const request: import('./types').PlaybackRequest = {
      primary: music,
      variants: allVariants,
      qualityPreference: tier,
    };
    try {
      const resolved = await raceQualityTierLazy(builtinPrimary, customBackend, request);
      debugLog(`[resolve] 命中 ${music.name} 轮=${tier.join('+')} 命中=${resolved.quality} backend=${resolved.backend} url=${resolved.url.slice(0, 60)}`);
      // 试听片段判定(与移动端同语义,见 @lx/core stream-integrity):
      // 30s 试听与完整版同样返回 206,靠 Content-Range / Content-Length 估算流时长,
      // 明显短于期望时长(music.interval)则视为试听:不写缓存、不进播放器,降档重试。
      const probeHeaders = buildStreamHeaders(music.source);
      const probe = await probeStreamUrl(resolved.url, probeHeaders);
      if (!probe.ok && probe.definitive) {
        // 服务端明确拒绝（403/404/410/451）：该地址确实拿不到资源，换下一档
        tierErrors.push(`探活失败(${probe.reason})`);
        continue;
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
      const playable = await prepareResolvedPlaybackMedia(music, resolved, options.cacheMedia !== false);
      void saveCachedPlaybackUrl(music, playable).catch(() => undefined);
      return playable;
    } catch (error) {
      tierErrors.push(error instanceof Error ? error.message : String(error));
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
      });
      debugLog(`[resolve] 官方直连兜底成功 ${music.name} url=${resolved.url.slice(0, 60)}`);
      // 官方直连兜底同样要过试听判定：wy eapi 无 VIP 正是返回 30s 试听的场景
      // （见 @lx/core stream-integrity 的说明），而这条路径不参与竞速、此前完全没做判定。
      // 判定为试听则按失败处理，与档位循环的「试听即作废、不写缓存、不进播放器」语义一致。
      const fallbackProbe = await probeStreamUrl(resolved.url, buildStreamHeaders(music.source));
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
        const playable = await prepareResolvedPlaybackMedia(music, resolved, options.cacheMedia !== false);
        void saveCachedPlaybackUrl(music, playable).catch(() => undefined);
        return playable;
      }
    } catch (error) {
      tierErrors.push(`内置音源(官方直连兜底): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const message = `播放地址解析失败(已尝试 ${qualityPreference.join(' → ')} 档):\n${tierErrors.join('\n')}`;
  debugLog(`[resolve] 全部失败 ${music.source}/${music.name}\n${message}`);
  throw new Error(message);
}

async function prepareResolvedPlaybackMedia(
  primary: MusicInfo,
  resolved: PlaybackResolvedUrl,
  cacheMedia: boolean,
): Promise<PlaybackResolvedUrl> {
  if (!cacheMedia) return resolved;
  try {
    return await cacheResolvedPlaybackMedia(primary, resolved);
  } catch (error) {
    // 媒体缓存（封面/音频落盘）失败不影响本次播放，仍用远端地址；
    // 但要留痕，否则“缓存一直不命中”会没人发现。
    debugLog(`[resolve] 媒体缓存处理失败，改用原地址: ${error instanceof Error ? error.message : String(error)}`);
    return resolved;
  }
}

export type { PlaybackBackendId, PlaybackResolvedUrl };
