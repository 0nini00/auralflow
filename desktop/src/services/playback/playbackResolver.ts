import type { MusicInfo } from '@lx/core';
import { buildPlaybackQualityTiers, DEFAULT_QUALITY_UPGRADE_WINDOW_MS, getPlaybackQualityFallbacks, raceForBestQuality } from '@lx/core';
import { debugLog, loadSettings } from '@lx/tauri-bridge';
import { estimateStreamDurationSeconds, isPreviewStream } from '@lx/core';
import { builtinNeteaseBackend } from './builtinNeteaseBackend';
import { builtinProviderBackend } from './builtinProviderBackend';
import { customSourceBackend } from './customSourceBackend';
import { probeStreamUrl } from './streamProbe';
import type { PlaybackBackendId, PlaybackResolvedUrl } from './types';
import { resolver } from '@/services/sources/sourceService';
import { getCachedPlaybackUrl, saveCachedPlaybackUrl } from '@/services/persistentCache';
import { cacheResolvedPlaybackMedia } from '@/services/mediaCache';

export async function resolvePlaybackUrl(
  music: MusicInfo,
  variants?: MusicInfo[],
  preferredQuality?: string,
  options: { bypassCache?: boolean; cacheMedia?: boolean } = {},
): Promise<PlaybackResolvedUrl> {
  // 解析链总预算：并发竞速已大幅压缩最坏等待，但个别网关/音源脚本卡死时
  // 仍需兜底；12s 内未出结果直接抛错走错误分支，不再无限等。
  return withResolveDeadline(resolvePlaybackUrlUncapped(music, variants, preferredQuality, options));
}

const PLAYBACK_RESOLVE_TOTAL_BUDGET_MS = 12_000;

/** 与移动端 buildStreamHeaders 同语义：wy/tx CDN 防盗链头。 */
function buildStreamHeaders(source: string | undefined): Record<string, string> | undefined {
  const referer =
    source === 'wy' ? 'https://music.163.com' : source === 'tx' ? 'https://y.qq.com' : undefined;
  if (!referer) return undefined;
  return { Referer: referer };
}

function withResolveDeadline(task: Promise<PlaybackResolvedUrl>): Promise<PlaybackResolvedUrl> {
  return new Promise<PlaybackResolvedUrl>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`播放地址解析超时（${PLAYBACK_RESOLVE_TOTAL_BUDGET_MS / 1000}s），请重试或切换音源`));
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

/** 参与竞速的 backend 候选（按调用顺序不影响结果，先到先得）。 */
function getRaceBackends(_music: MusicInfo): Array<{ id: PlaybackBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> }> {
  const backends: Array<{ id: PlaybackBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> }> = [];
  // 网关通道无条件参赛：backend 内部自行裁决——有网关元数据 / wy 源直接按 id 解析；
  // 网关不支持直连的源（如 tx）降级「歌名+歌手」同名搜索后解析。
  backends.push({ id: 'builtinNetease', resolve: (request) => builtinNeteaseBackend.resolve(request) });
  backends.push({ id: 'customSource', resolve: (request) => customSourceBackend.resolve(request) });
  return backends;
}

/**
 * 单轮竞速：把该轮的全部音质档同时交给所有 backend（内置网关、自定义音源），
 * 成功结果里取音质最高者——首个成功结果开启一个升级窗口，窗口内有更高档就换。
 *
 * 与旧实现（先到先得）的差别：backend 内部已按音质择优，外层若仍先到先得，
 * 会让网关的低档结果抢在自定义音源的高档结果前面，把择优逻辑架空。
 */
async function raceQualityTier(
  backends: Array<{ id: PlaybackBackendId; resolve: (request: import('./types').PlaybackRequest) => Promise<PlaybackResolvedUrl> }>,
  request: import('./types').PlaybackRequest,
): Promise<PlaybackResolvedUrl> {
  const attempts = backends.map((backend) =>
    backend.resolve(request).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${backend.id}: ${message}`);
    }),
  );

  return raceForBestQuality(attempts, {
    getQuality: (resolved) => resolved.quality,
    upgradeWindowMs: DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
    // 本轮最高档命中即定稿，不再等窗口
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
  // 分轮次：首轮是「不低于选定音质」的全部档位一起竞速，之后逐档下调。
  const qualityTiers = buildPlaybackQualityTiers(qualityFloor);
  // 扁平降级链仅用于缓存查询与官方直连兜底，这两处不分轮次。
  const qualityPreference = getPlaybackQualityFallbacks(qualityFloor);
  debugLog(`[resolve] 开始解析 ${music.source}/${music.name} id=${music.id} 音质轮次=${qualityTiers.map((tier) => tier.join('+')).join(' > ')}`);
  const allVariants = variants?.length ? variants : [music];
  const cacheVariants = allVariants.some((item) => item.source === music.source && item.id === music.id)
    ? allVariants
    : [music, ...allVariants];

  if (!options.bypassCache) {
    try {
      const cached = await getCachedPlaybackUrl(music, qualityPreference, cacheVariants);
      // 持久化条目存的可能是会过期的远端地址；再过一次媒体缓存，
      // 音频已落盘时升级为本地文件，避免命中过期 URL。
      if (cached) {
        debugLog(`[resolve] 命中持久化缓存 ${music.name} url=${cached.url.slice(0, 60)}`);
        return await prepareResolvedPlaybackMedia(music, cached, options.cacheMedia !== false);
      }
    } catch (error) {
    }
  }

  // B 站解析无音质分层且接口链路较慢，提前单独解析，不进音质竞速。
  if (music.source === 'bili' && resolver.getSource(music.source)) {
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

  // 每轮把该轮全部档位同时交给内置网关/自定义音源竞速，取音质最高的成功结果；
  // 该轮全败才进入下一轮（更低档）。（对齐移动端：wy/tx 官方直连 provider 不参与竞速）
  const backends = getRaceBackends(music);
  const tierErrors: string[] = [];
  for (const tier of qualityTiers) {
    const request: import('./types').PlaybackRequest = {
      primary: music,
      variants: allVariants,
      qualityPreference: tier,
    };
    try {
      const resolved = await raceQualityTier(backends, request);
      debugLog(`[resolve] 竞速成功 ${music.name} 轮=${tier.join('+')} 命中=${resolved.quality} backend=${resolved.backend} url=${resolved.url.slice(0, 60)}`);
      // 试听片段判定（与移动端同语义，见 @lx/core stream-integrity）：
      // 30s 试听与完整版同样返回 206，靠 Content-Range / Content-Length 估算流时长，
      // 明显短于期望时长（music.interval）则视为试听：不写缓存、不进播放器，降档重试。
      const probeHeaders = buildStreamHeaders(music.source);
      const probe = await probeStreamUrl(resolved.url, probeHeaders);
      if (!probe.ok) {
        tierErrors.push(`探活失败（${probe.reason}）`);
        continue;
      }
      if (
        probe.ok &&
        probe.totalBytes != null &&
        isPreviewStream({
          totalBytes: probe.totalBytes,
          quality: resolved.quality,
          expectedDurationSeconds: music.interval,
        })
      ) {
        const previewSeconds = estimateStreamDurationSeconds(probe.totalBytes, resolved.quality);
        tierErrors.push(`解析到试听片段（约 ${Math.round(previewSeconds ?? 0)}s）`);
        continue;
      }
      const playable = await prepareResolvedPlaybackMedia(music, resolved, options.cacheMedia !== false);
      void saveCachedPlaybackUrl(music, playable).catch(() => undefined);
      return playable;
    } catch (error) {
      tierErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  // 竞速全败后的最后保险：wy/tx 官方直连 provider。不参与竞速（对齐移动端），
  // 但网关整条挂掉时不至于整首失败
  if (resolver.getSource(music.source)) {
    try {
      const resolved = await builtinProviderBackend.resolve({
        primary: music,
        variants: allVariants,
        qualityPreference,
      });
      debugLog(`[resolve] 官方直连兜底成功 ${music.name} url=${resolved.url.slice(0, 60)}`);
      const playable = await prepareResolvedPlaybackMedia(music, resolved, options.cacheMedia !== false);
      void saveCachedPlaybackUrl(music, playable).catch(() => undefined);
      return playable;
    } catch (error) {
      tierErrors.push(`内置音源（官方直连兜底）: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const message = `播放地址解析失败（已尝试 ${qualityPreference.join(' → ')} 档）：\n${tierErrors.join('\n')}`;
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
    return resolved;
  }
}

export type { PlaybackBackendId, PlaybackResolvedUrl };
