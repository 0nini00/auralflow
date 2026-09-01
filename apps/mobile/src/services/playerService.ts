import type { MusicInfo, LyricLine } from "@lx/core";
import { parseUrl, getLyrics, buildStreamHeaders, STREAM_USER_AGENT } from "./musicApi";
import { resolveWySongUrl } from "./wyDirectProvider";
import { resolveBiliSongUrl } from "./biliService";
import { usePlayerStore } from "../stores/playerStore";
import type { PlayMode } from "../stores/playerStore";
import { useHistoryStore } from "../stores/historyStore";
import { useCustomSourceStore } from "../stores/customSourceStore";
import { requestCustomSourceMusicUrl } from "./customSourceRuntime";
import { cacheCover, cacheLyrics, getCachedLyrics, cacheAudioFile, getCachedAudioFile, isLocalFilePlayable, CACHEABLE_AUDIO_SOURCES } from "./cacheService";
import { getCachedPlaybackUrl, saveCachedPlaybackUrl, invalidateCachedPlaybackUrl } from "./playbackUrlCache";
import { getPersonalFmSongs, trashPersonalFmSong } from "./wyPlaylistService";
import { getNextQueueNavigationState, getPreviousQueueNavigationState } from "@/services/queueNavigationModel";
import { dequeueTempPlayList, insertSongToPlayNext } from "@/services/songQueueActions";
import { buildPlaybackQualityTiers, getPlaybackQualityFallbacks, normalizePlaybackQuality, resolveEffectivePlaybackQuality, type PlaybackQuality } from "@/services/playbackQualityModel";
import { DEFAULT_QUALITY_UPGRADE_WINDOW_MS, estimateStreamDurationSeconds, isPreviewStream, raceForBestQuality } from "@lx/core";
import { applySwitchStepRequest, createSwitchStepQueueState, finishSwitchStep } from "@lx/core";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { buildPlaybackPrefetchKey, isPlaybackPrefetchKeyForSong } from "@/services/playbackPrefetchModel";
import { probeStreamUrl } from "./streamProbe";

/**
 * 提取 URL 的协议与主机用于错误提示，丢弃路径与查询串（可能含鉴权 token）。
 * 明文 http 在 release 构建会被 Android 直接拒绝，错误文案里带上协议才能一眼区分。
 */
function describeUrlOrigin(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(url);
  return match ? `${match[1]}://${match[2]}` : "地址格式异常";
}
// ─────────────────────────────────────────────────────────────
// 预读下一首：模块级缓存，解析后只缓存 URL（不播放）
// ─────────────────────────────────────────────────────────────
interface PrefetchedUrl {
  url: string;
  headers?: Record<string, string>;
  fetchedAt: number;
}
const PREFETCH_TTL_MS = 10 * 60 * 1000;
/** 预读条目超过该龄后命中需补探活：过期 CDN 链接直接进播放器会触发 PlaybackError（失败即停）。 */
const PREFETCH_PROBE_AFTER_MS = 60 * 1000;
/**
 * 并发竞速整条降级链的总时间预算。
 *
 * 每档内网关与自定义源并发，单次请求超时 15s；多档串行最坏仍会叠加，
 * 给整条链一个总 deadline，超时停止降档直接报错，切歌在可预期时间内出结果。
 */
const RESOLVE_RACE_BUDGET_MS = 10_000;
/**
 * 整条解析链的总预算帽（对齐桌面端 withResolveDeadline）。
 *
 * 内层 20s/15s 两级预算互相独立、串行最坏可达 35s，bili 多级取链更是完全没有预算；
 * 这里在 playSongCore 调用 resolveSongUrl 处再套一层 25s 总 race，先到先出：
 * 内层预算先触发就先退出，总帽只兜底，超时统一报「解析超时」。
 */
const RESOLVE_TOTAL_BUDGET_MS = 12_000;
/** FM 当前批次（播放历史）上限：只保留最新 50 条，对齐桌面端 fmHistory 上限。 */
const FM_HISTORY_MAX = 50;
const prefetchCache = new Map<string, PrefetchedUrl>();

/** 在线音频流统一浏览器 UA / wy、tx CDN 防盗链头由 musicApi 共享（播放与下载共用）。 */

function getCachedPrefetch(
  song: MusicInfo,
  qualities: string | readonly string[],
): PrefetchedUrl | undefined {
  const candidates = typeof qualities === "string" ? [qualities] : qualities;
  for (const quality of candidates) {
    const key = buildPlaybackPrefetchKey(song, quality);
    const entry = prefetchCache.get(key);
    if (entry && Date.now() - entry.fetchedAt < PREFETCH_TTL_MS) return entry;
    if (entry) prefetchCache.delete(key);
  }
  return undefined;
}

export function clearPrefetchCache(): void {
  prefetchCache.clear();
}

/** 清掉某首歌的预读缓存（切换音质时必须失效旧 URL）。 */
export function invalidatePrefetchForSong(song: MusicInfo): void {
  for (const key of prefetchCache.keys()) {
    if (isPlaybackPrefetchKeyForSong(key, song)) prefetchCache.delete(key);
  }
}

/**
 * 自定义音源解析：所有「已启用音源 × 本轮音质」组合并发竞速，取音质最高的成功结果。
 *
 * 用户要求（2026-08）：音源之间竞速，且音质不低于所选档位——某音源只有 flac
 * 而用户选 320k 时该 flac 也应参与竞速。首个成功结果开启升级窗口，窗口内有更高
 * 档位就换，达到本轮最高档则立即定稿。
 * 无启用源时快速抛错，不阻塞并发的网关通道。
 */
export async function resolveUrlWithCustomSource(
  song: MusicInfo,
  qualities: string[],
): Promise<{ url: string; quality: string }> {
  const enabledSources = useCustomSourceStore
    .getState()
    .sources.filter((source) => source.enabled);
  if (enabledSources.length === 0) {
    throw new Error("无可用的自定义音源");
  }
  if (qualities.length === 0) {
    throw new Error("没有可尝试的音质档位");
  }

  const attempts: Array<Promise<{ url: string; quality: string }>> = [];
  for (const source of enabledSources) {
    for (const quality of qualities) {
      attempts.push(
        // 取链期间脚本主动 send(updateAlert) 时写入 store，让全局更新弹窗能感知
        requestCustomSourceMusicUrl(source, song, quality, (alert) => {
          useCustomSourceStore.getState().applyRuntimeUpdateAlert(source.id, alert);
        }).then((result) => ({
          url: result.url,
          // 与网关通道同样归一化：脚本可能回传 "flac24bit" 之外的别名
          quality: normalizePlaybackQuality(result.quality || quality),
        })),
      );
    }
  }

  return raceForBestQuality(attempts, {
    getQuality: (value) => value.quality,
    upgradeWindowMs: DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
    ceiling: qualities[0],
    formatError: (errors) => {
      const detail = errors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join(" | ");
      return new Error(detail || "所有自定义音源均解析失败");
    },
  });
}

/**
 * 单轮竞速：内置网关与自定义音源同时发起本轮全部音质档，取音质最高的成功结果。
 *
 * 旧链路是串行降级（网关全链失败才轮到自定义源），慢通道会阻塞切歌；
 * 用户要求（2026-08）：不低于所选音质的档位一起竞速，本轮全败才降下一档。
 * 择优而非先到先得：否则网关的低档结果会抢在自定义音源的高档结果前面。
 */
async function raceQualityTier(
  song: MusicInfo,
  qualities: string[],
): Promise<{ url: string; quality: string; fromCustomSource: boolean }> {
  // 网关通道内部按音质从高到低顺序尝试，第一个成功的即本轮最高可用档。
  // 不对每档并发：gdstudio 是免费网关，同一首歌并发多档容易触发限流，
  // 且顺序高→低本身就等价于择优（对齐桌面端 builtinNeteaseBackend）。
  // 音质统一归一化为标签：网关返回的是 br 数字串（"740"/"999"），
  // 而预读/持久化缓存的 key 用的是音质标签，不归一化会导致缓存永远查不到。
  const gatewayAttempt = (async () => {
    const errors: string[] = [];
    for (const quality of qualities) {
      try {
        const result = await parseUrl(song, quality);
        return {
          url: result.url,
          quality: normalizePlaybackQuality(result.quality || quality),
          fromCustomSource: false,
        };
      } catch (error) {
        errors.push(`${quality}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`内置音乐 API 解析失败：${errors.join(" | ")}`);
  })();
  const customAttempt = resolveUrlWithCustomSource(song, qualities).then(
    (result) => ({ ...result, fromCustomSource: true }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`自定义音源解析失败：${message}`);
    },
  );

  return raceForBestQuality([gatewayAttempt, customAttempt], {
    getQuality: (value) => value.quality,
    upgradeWindowMs: DEFAULT_QUALITY_UPGRADE_WINDOW_MS,
    ceiling: qualities[0],
    formatError: (errors) => {
      const detail = errors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join("；");
      return new Error(detail || "该音质档位全部解析失败");
    },
  });
}

/**
 * 解析单首歌曲的播放地址（优先命中预读缓存）。
 * 解析成功后写入预读缓存，供 playNext/playPrevious 直接复用。
 */
async function resolveSongUrl(
  song: MusicInfo,
  qualityOverride?: string | null,
): Promise<{ url: string; headers?: Record<string, string> }> {
  // 计算音质降级链（显式指定音质时跳过预读/持久化缓存，避免旧码率命中）
  const quality = qualityOverride
    ? resolveEffectivePlaybackQuality(qualityOverride, qualityOverride)
    : resolveEffectivePlaybackQuality(song.quality, usePlaybackSettingsStore.getState().defaultQuality);
  const qualityCandidates = getPlaybackQualityFallbacks(quality);
  // 分轮次表：首轮为「不低于选定音质」的全部档位，之后逐档下调。
  const qualityTiers = buildPlaybackQualityTiers(quality);

  // 1. 命中预读缓存直接返回
  if (!qualityOverride) {
    const prefetched = getCachedPrefetch(song, qualityCandidates);
    if (prefetched) {
      // 本地文件与新鲜条目直接用；超龄条目补一次轻量探活——
      // 预读时距实际播放可能隔着整首歌（甚至达到 TTL 边界），CDN 链接可能已失效，
      // 探不通就地作废走重新解析，避免把死链交给播放器触发「播放即停」
      if (prefetched.url.startsWith("file://") || Date.now() - prefetched.fetchedAt < PREFETCH_PROBE_AFTER_MS) {
        return { url: prefetched.url, headers: prefetched.headers };
      }
      const prefetchHeaders = prefetched.headers ?? buildStreamHeaders(song.source);
      const prefetchProbe = await probeStreamUrl(prefetched.url, prefetchHeaders);
      if (prefetchProbe.ok) {
        return { url: prefetched.url, headers: prefetchHeaders };
      }
      invalidatePrefetchForSong(song);
    }
    // 1.2 直接命中本地音频缓存文件（lx isCached 等价）：优先整曲落盘的 wy/tx 等可缓存音源，
    // 离线可播、省流量，不必依赖持久化 URL 缓存中的 file:// 条目（该条目可能被清理/过期）。
    // 按降级链逐个候选查（cacheAudioFile 写盘用的是实际解析成功的音质，可能低于有效音质），
    // 与持久化 URL 缓存的降级语义一致，避免降级播放后下次播放查不到本地文件。
    if (CACHEABLE_AUDIO_SOURCES.has(song.source)) {
      for (const candidate of qualityCandidates) {
        const cachedAudioPath = await getCachedAudioFile(song, candidate);
        if (!cachedAudioPath) continue;
        prefetchCache.set(buildPlaybackPrefetchKey(song, candidate), {
          url: cachedAudioPath,
          headers: undefined,
          fetchedAt: Date.now(),
        });
        return { url: cachedAudioPath, headers: undefined };
      }
    }
    // 1.5 命中持久化 URL 缓存：冷启动/重启后免重新解析网关，对齐桌面端 persistentCache
    const persisted = await getCachedPlaybackUrl(song, qualityCandidates);
    if (persisted) {
      // 持久化缓存可能存的是本地音频文件（#2 媒体缓存）：校验文件未被清理策略回收
      if (persisted.url.startsWith("file://")) {
        if (await isLocalFilePlayable(persisted.url)) {
          prefetchCache.set(buildPlaybackPrefetchKey(song, persisted.quality), {
            url: persisted.url,
            headers: undefined,
            fetchedAt: Date.now(),
          });
          return { url: persisted.url, headers: undefined };
        }
        void invalidateCachedPlaybackUrl(song, persisted.quality).catch(() => undefined);
      } else {
        // 旧持久化条目可能没存 headers（修复前写入）：按音源补齐防盗链头，避免命中旧缓存仍 403
        const persistedHeaders = persisted.headers ?? buildStreamHeaders(song.source);
        // 持久化缓存同样探活：死代理 URL 不会触发 PlaybackError，缓存会无限命中死链，
        // 表现为重启 app 后同一首歌永远缓冲。探不通就地作废，走下面重新解析。
        const probe = await probeStreamUrl(persisted.url, persistedHeaders);
        if (probe.ok) {
          prefetchCache.set(buildPlaybackPrefetchKey(song, persisted.quality), {
            url: persisted.url,
            headers: persistedHeaders,
            fetchedAt: Date.now(),
          });
          return { url: persisted.url, headers: persistedHeaders };
        }
        void invalidateCachedPlaybackUrl(song, persisted.quality).catch(() => undefined);
      }
    }
  }

  // 2. 实际解析
  let url!: string;
  let headers: Record<string, string> | undefined;
  let resolvedQuality: string | undefined;
  if (song.isLocal && song.url) {
    url = song.url;
  } else if (song.source === "bili") {
    const result = await resolveBiliSongUrl(song);
    url = result.url;
    headers = {
      Referer: result.referer,
      "User-Agent": STREAM_USER_AGENT,
    };
  } else {
    // 分轮次竞速（用户要求 2026-08）：首轮把「不低于选定音质」的全部档位
    // 同时交给内置网关与自定义音源，取音质最高的成功结果；本轮全败才降下一档。
    const resolveDeadline = Date.now() + RESOLVE_RACE_BUDGET_MS;
    let lastTierError: unknown = null;
    let raced: { url: string; quality: string; fromCustomSource: boolean } | null = null;
    for (const tier of qualityTiers) {
      if (Date.now() >= resolveDeadline) {
        lastTierError = lastTierError ?? new Error(`解析播放地址超时，请重试`);
        break;
      }
      try {
        const racedResult = await raceQualityTier(song, tier);
        // 防盗链 headers 统一按音源补齐：LX 自定义音源返回的也多为 wy/tx 官方 CDN 链接，
        // 缺 Referer 会直接 403（竞速版本初期的回归点）；其他源 CDN 无 Referer 要求，多带无害。
        const candidateHeaders = buildStreamHeaders(song.source);
        // 死代理探活：LX 音源代理等黑盒服务器可能 TCP 连上后永不返回数据，
        // ExoPlayer 会无限缓冲无任何错误。竞速胜出后用 1 字节 Range 探测可用性，
        // 探不通视为该轮失败，继续降下一档音质重试。
        const probe = await probeStreamUrl(racedResult.url, candidateHeaders);
        if (!probe.ok) {
          // 带上地址来源（协议 + 主机，不含可能含 token 的路径与查询串）：
          // 明文 http 被 Android 拦截、代理域名不可达等失败在错误文案上无法区分，
          // 没有来源信息只能靠猜。
          lastTierError = new Error(
            `解析的播放地址不可用（${probe.reason}）[${describeUrlOrigin(racedResult.url)}]`,
          );
          continue;
        }
        // 试听判定：30s 试听与完整版同样返回 206，靠 Content-Range / Content-Length
        // 估算流时长后与期望时长（song.interval）比对，是试听则本档作废继续降档。
        if (
          probe.ok &&
          probe.totalBytes != null &&
          isPreviewStream({
            totalBytes: probe.totalBytes,
            quality: racedResult.quality,
            expectedDurationSeconds: song.interval,
          })
        ) {
          const previewSeconds = estimateStreamDurationSeconds(probe.totalBytes, racedResult.quality);
          lastTierError = new Error(
            `解析到试听片段（约 ${Math.round(previewSeconds ?? 0)}s），已跳过并降档重试`,
          );
          continue;
        }
        raced = racedResult;
        url = racedResult.url;
        headers = candidateHeaders;
        resolvedQuality = racedResult.quality;
        break;
      } catch (error) {
        lastTierError = error;
      }
    }
    if (!raced) {
      // 竞速全败后的最后保险：wy 官方直连（对齐桌面端 2026-08 兜底语义；
      // tx 无官方直连可用，其兜底是网关同名搜索，已在音乐 API 层处理）。
      if (song.source === "wy") {
        try {
          const directQuality = (qualityCandidates[0] ?? quality) as PlaybackQuality;
          const directUrl = await resolveWySongUrl(song, directQuality);
          url = directUrl;
          headers = buildStreamHeaders(song.source);
          resolvedQuality = String(directQuality);
          raced = { url: directUrl, quality: String(directQuality), fromCustomSource: false };
        } catch (directError) {
          const directMessage = directError instanceof Error ? directError.message : String(directError);
          const previous = lastTierError instanceof Error ? lastTierError.message : String(lastTierError ?? "");
          lastTierError = new Error(`${previous}；wy 官方直连也失败：${directMessage}`);
        }
      }
      if (!raced) {
        throw lastTierError instanceof Error
          ? lastTierError
          : new Error("无法获取播放地址");
      }
    }
  }
  if (!url) {
    throw new Error("无法获取播放地址");
  }

  const cacheQuality = resolvedQuality ?? qualityOverride ?? quality;

  // 3. 写入预读缓存
  prefetchCache.set(buildPlaybackPrefetchKey(song, cacheQuality), { url, headers, fetchedAt: Date.now() });

  // 3.5 写入持久化 URL 缓存（本地文件不缓存）
  if (!song.isLocal && song.source !== "local") {
    void saveCachedPlaybackUrl(song, { url, quality: cacheQuality, headers }).catch(() => {});

    // 3.6 后台缓存音频文件到本地（仅 wy/tx，对齐桌面端 CACHEABLE_AUDIO_SOURCES），
    // 下载完成后把本地 file:// 写回持久化缓存与预读缓存，下次播放离线即开。
    if (CACHEABLE_AUDIO_SOURCES.has(song.source) && /^https?:\/\//i.test(url)) {
      void cacheAudioFile(url, song, cacheQuality)
        .then((localPath) => {
          if (!localPath) return;
          prefetchCache.set(buildPlaybackPrefetchKey(song, cacheQuality), {
            url: localPath,
            headers: undefined,
            fetchedAt: Date.now(),
          });
          void saveCachedPlaybackUrl(song, { url: localPath, quality: cacheQuality }).catch(() => undefined);
        })
        .catch(() => undefined);
    }
  }

  return { url, headers };
}

/**
 * 邻近歌曲预读窗口（对齐桌面端 PREFETCH_OFFSETS：上一首 + 下两首）。
 * 非随机模式按 [-1, 1, 2]；随机模式按 [1, 2, -1]。
 */
const PREFETCH_OFFSETS = [-1, 1, 2] as const;
const SHUFFLE_PREFETCH_OFFSETS = [1, 2, -1] as const;

function isQueueWrappingMode(playMode: PlayMode): boolean {
  return playMode === "list" || playMode === "shuffle";
}

/**
 * 计算当前曲周围需预读的候选索引（去重、排除当前曲、按播放模式处理越界环绕）。
 * single 单曲循环无邻近预读。
 */
export function getNearbyQueueIndexes(
  queueLength: number,
  currentIndex: number,
  playMode: PlayMode,
): number[] {
  if (queueLength <= 0 || currentIndex < 0 || currentIndex >= queueLength) return [];
  if (playMode === "single") return [];
  const wrap = isQueueWrappingMode(playMode);
  const offsets = playMode === "shuffle" ? SHUFFLE_PREFETCH_OFFSETS : PREFETCH_OFFSETS;
  const seen = new Set<number>([currentIndex]);
  const result: number[] = [];
  for (const offset of offsets) {
    const rawIndex = currentIndex + offset;
    let index: number | null = null;
    if (rawIndex >= 0 && rawIndex < queueLength) {
      index = rawIndex;
    } else if (wrap) {
      index = ((rawIndex % queueLength) + queueLength) % queueLength;
    }
    if (index == null || seen.has(index)) continue;
    seen.add(index);
    result.push(index);
  }
  return result;
}

/** 取当前曲邻近需预读的歌曲列表。
 *  queue 上下文：队列邻近（上一首 + 下两首）；
 *  personalFm：当前批次下一首 + 缓冲头部 2 首——FM 切歌同样需要预取 URL，
 *  否则每次「下一首」都实时走网关解析，正是 FM 切歌慢的根因。
 */
function getNearbySongs(): MusicInfo[] {
  const { playbackContext, queue, currentIndex, playMode } = usePlayerStore.getState();
  if (playbackContext.type === "personalFm") {
    const seen = new Set<string>();
    const result: MusicInfo[] = [];
    const push = (song: MusicInfo | undefined) => {
      if (!song) return;
      const key = `${song.source}:${song.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(song);
    };
    push(playbackContext.currentBatch[playbackContext.currentBatchIndex + 1]);
    push(playbackContext.buffer[0]);
    push(playbackContext.buffer[1]);
    return result;
  }
  return getNearbyQueueIndexes(queue.length, currentIndex, playMode)
    .map((index) => queue[index])
    .filter((song): song is MusicInfo => !!song);
}

/**
 * 预取单曲的歌词（缓存未命中时拉取并写入缓存），供切歌时秒开。
 * 已有缓存则直接跳过，不产生网络请求。
 */
function prefetchLyrics(song: MusicInfo): void {
  getCachedLyrics(song)
    .then((cached) => {
      if (cached && cached.length > 0) return;
      return getLyrics(song).then((lyrics) => {
        if (lyrics.length > 0) return cacheLyrics(song, lyrics);
      });
    })
    .catch(() => undefined);
}

/**
 * 预取单曲封面到本地缓存，供 CachedImage 直接命中。
 */
function prefetchCover(song: MusicInfo): void {
  const cover = song.picUrl || song.img;
  if (!cover) return;
  cacheCover(cover).catch(() => undefined);
}

/**
 * 异步预读邻近歌曲（上一首 + 下两首，对齐桌面端 prefetchNearbyTracks）：
 * 解析并缓存播放 URL、预取歌词与封面，使切歌时 URL/歌词/封面秒开。
 * 只做缓存预取，不写入 TrackPlayer 原生队列（原生始终保持单曲，切歌由 JS 调度）。
 */
function prefetchNearbySongs(): void {
  const nearby = getNearbySongs();
  for (const song of nearby) {
    prefetchSong(song);
  }
}

/**
 * 在途预读任务（按预读 key = 音源:id:音质 去重）。
 * 曲末预读由 0.25s 一次的进度事件驱动，没有这道锁会对同一首歌重复发起整条解析链。
 */
const prefetchInflight = new Map<string, Promise<void>>();

/**
 * 预取单首歌曲的播放 URL/歌词/封面（幂等：各自内部跳过已命中项）。
 * 供「下一首播放/稍后播放」插入时立即预热，播到它时命中缓存秒开。
 */
export function prefetchSong(song: MusicInfo): void {
  // 歌词/封面无论 URL 是否已缓存都尝试预取（各自内部会跳过已命中项）
  prefetchLyrics(song);
  prefetchCover(song);
  // 已有当前有效音质的新鲜 URL 缓存则跳过 URL 解析
  const quality = resolveEffectivePlaybackQuality(
    song.quality,
    usePlaybackSettingsStore.getState().defaultQuality,
  );
  if (getCachedPrefetch(song, quality)) return;
  // 同一「歌 + 音质」的解析已在途则复用，不再发起第二条解析链
  const inflightKey = buildPlaybackPrefetchKey(song, quality);
  if (prefetchInflight.has(inflightKey)) return;
  // 只解析并缓存播放 URL（prefetchCache 命中后 playNext/playPrevious 秒开），
  // 不写入 TrackPlayer 原生队列——原生始终保持单曲，切歌由 JS 调度。
  const task = resolveSongUrl(song).then(
    () => undefined,
    () => undefined,
  );
  prefetchInflight.set(
    inflightKey,
    task.finally(() => {
      prefetchInflight.delete(inflightKey);
    }),
  );
}

/**
 * 取「即将播放的下一首」用于曲末提前预解析。只读 store，不写任何状态
 * （随机历史 / playedIndices 仍由 playNext 在真正切歌时更新）。
 *
 * 优先级与 playNext 一致：稍后播放暂存区首曲 → FM 当前批次下一首/缓冲头部 → 队列下一首。
 * single 单曲循环与「顺序播放已到队尾」返回 undefined，不产生任何预读副作用。
 */
function getNextSongForPrefetch(): MusicInfo | undefined {
  const { playbackContext, queue, currentIndex, playMode, tempPlayList, shuffleHistory, playedIndices } =
    usePlayerStore.getState();
  if (tempPlayList.length > 0) return tempPlayList[0];
  if (playbackContext.type === "personalFm") {
    return (
      playbackContext.currentBatch[playbackContext.currentBatchIndex + 1] ?? playbackContext.buffer[0]
    );
  }
  if (playMode === "single") return undefined;
  // 随机模式的下一首在 playNext 里才抽取，这里不预抽（会与真正切歌抽到的不一致，
  // 更不能推进 playedIndices）：沿用邻近预读窗口的首个候选，命中即秒开、不中也只多一次后台解析。
  const nextIndex =
    playMode === "shuffle"
      ? getNearbyQueueIndexes(queue.length, currentIndex, playMode)[0]
      : getNextQueueNavigationState({
          queueLength: queue.length,
          currentIndex,
          playMode,
          shuffleHistory,
          playedIndices,
        }).nextIndex;
  if (nextIndex == null || nextIndex === currentIndex) return undefined;
  return queue[nextIndex];
}

/** 曲末提前预解析窗口（秒）：剩余进入该窗口即预读下一首，留足整条解析链的时间。 */
const UPCOMING_PREFETCH_LEAD_SECONDS = 10;

/** 上一次触发曲末预读的「当前曲 → 下一首」组合，避免进度事件重复触发。 */
let lastUpcomingPrefetchKey: string | null = null;

/**
 * 曲末提前预解析入口（供进度事件调用）：剩余时间进入窗口时预读下一首。
 *
 * 三重去重：窗口外直接返回、同一「当前曲 → 下一首」组合只触发一次、
 * prefetchSong 内部按预读 key 命中缓存/在途即跳过。
 * 无下一首（顺序播放队尾、空队列）与 single 单曲循环不做任何事。
 */
export function prefetchUpcomingSongNearEnd(position: number, duration: number): void {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;
  const remaining = duration - position;
  if (remaining <= 0 || remaining > UPCOMING_PREFETCH_LEAD_SECONDS) return;
  const nextSong = getNextSongForPrefetch();
  if (!nextSong) return;
  const currentSong = usePlayerStore.getState().currentSong;
  const key = `${currentSong ? `${currentSong.source}:${currentSong.id}` : "-"}->${nextSong.source}:${nextSong.id}`;
  if (key === lastUpcomingPrefetchKey) return;
  lastUpcomingPrefetchKey = key;
  prefetchSong(nextSong);
}

// playSongCore 级别的播放意图序号：每次发起新的播放意图（含切音质）递增。
// play() 内部的 requestId 只能淘汰「已进入 play」后被抢占的请求；解析慢的旧请求
// 拿到的是新令牌，检查全过——必须在「解析返回 → 调 play」之间用本序号拦截。
let playIntentSeq = 0;

// 切歌连点合并：切换进行中（解析/播放器加载）时重复点击只补跳一次，不重复解析。
let switchStepQueue = createSwitchStepQueueState();

/**
 * 播放歌曲（完整流程）
 */
/** 当前切歌完成后消费连点补跳（只补一次，防止循环）。 */
async function completeQueuedSwitchStep(): Promise<void> {
  const finished = finishSwitchStep(switchStepQueue);
  switchStepQueue = finished.nextState;
  if (finished.shouldStep) {
    void (finished.direction === "prev" ? playPrevious() : playNext()).catch(() => undefined);
  }
}

async function playSongCore(song: MusicInfo, startPosition?: number): Promise<void> {
  const { play, setLoading, setError } = usePlayerStore.getState();
  const { addToHistory } = useHistoryStore.getState();
  const intent = ++playIntentSeq;
  try {
    setLoading(true);
    setError(null);
    // 1. 解析播放 URL（命中预读缓存时无需等待网络）。
    // 整条解析链（内置降级链→自定义源兜底、bili 多级取链）统一套 25s 总预算帽：
    // 内层 20s/15s 预算保留不动、先触发就先退出，总帽只兜底串行叠加（最坏 35s）。
    // 超时后迟到的解析结果不会再走到 play（await 已 reject）；
    // 未超时但迟到的旧意图（用户已改点其它歌曲）由下方 intent 序号拦截，
    // 避免十几秒后突然劫持播放；迟到的成功结果仍会静默写缓存，供下次命中。
    const { url, headers } = await Promise.race([
      resolveSongUrl(song),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("解析超时")), RESOLVE_TOTAL_BUDGET_MS),
      ),
    ]);
    if (intent !== playIntentSeq) return;
    // 2. 播放（B站音源需要带 headers；startPosition 用于快照恢复续播）
    await play(song, url, headers, startPosition);
    // 3. 添加到历史（过期请求不写历史：play 因竞态被丢弃时静默 return、
    //    不会把 currentSong 置为本次的 song，据此跳过历史写入）
    if (usePlayerStore.getState().currentSong === song) {
      await addToHistory(song);
      // 歌词同样以「本曲仍是在播曲」为前提加载，避免过期请求把别首歌的歌词
      // 写进 store 造成音词错位；intent 序号贯穿 loadLyrics 的每个 await 之后
      loadLyrics(song, intent);
    }
    // 4. 异步缓存封面
    if (song.picUrl || song.img) {
      cacheCover(song.picUrl || song.img!).catch(() => undefined);
    }
    // 5. 异步预读邻近歌曲（上一首 + 下两首）：解析 URL/歌词/封面入缓存，下一首提前入队
    prefetchNearbySongs();
  } catch (error) {
    const message = error instanceof Error ? error.message : "播放失败";
    setError(message);
    throw error;
  } finally {
    // 请求被更新的播放意图取代时，loading 归新请求所有，不提前清掉它的加载态
    if (intent === playIntentSeq) {
      setLoading(false);
    }
  }
}

/**
 * 切换当前曲的播放音质：清缓存 → 按目标音质重解析 → 尽量从原进度续播。
 * 本地曲 / B站等不走音质阶梯的源会直接抛错。
 */
export async function switchCurrentPlaybackQuality(quality: string): Promise<void> {
  const store = usePlayerStore.getState();
  const currentSong = store.currentSong;
  if (!currentSong) {
    throw new Error("当前没有正在播放的歌曲");
  }
  if (currentSong.isLocal || currentSong.source === "local") {
    throw new Error("本地歌曲不支持切换在线音质");
  }
  if (currentSong.source === "bili") {
    throw new Error("B站音源暂不支持手动切换音质");
  }

  // 失效旧音质的持久化 URL 缓存，确保切换后按新音质重新解析（对齐桌面端）
  invalidateCachedPlaybackUrl(currentSong, currentSong.quality);

  const resumePosition = store.position;
  const wasPlaying = store.isPlaying;
  const nextSong: MusicInfo = {
    ...currentSong,
    quality: quality as MusicInfo["quality"],
  };

  // 队列里同步更新 quality，后续切回这首仍用新音质；不改设置页默认音质
  const nextQueue = store.queue.map((item) =>
    item.source === currentSong.source && String(item.id) === String(currentSong.id)
      ? { ...item, quality: nextSong.quality }
      : item,
  );
  usePlayerStore.setState({ queue: nextQueue, currentSong: nextSong });

  invalidatePrefetchForSong(currentSong);
  invalidatePrefetchForSong(nextSong);

  const { play, setLoading, setError } = usePlayerStore.getState();
  // 切音质也是一次播放意图：解析期间用户改点其它歌/重播本曲时，本次结果作废
  const intent = ++playIntentSeq;
  try {
    setLoading(true);
    setError(null);
    const { url, headers } = await resolveSongUrl(nextSong, quality);
    if (intent !== playIntentSeq) return;
    // 直接以原进度开播（play 内部 seek 后才淡入），避免「先从头播再跳回」的回跳感
    await play(nextSong, url, headers, resumePosition > 1 ? resumePosition : undefined);
    if (!wasPlaying) {
      // 暂停态切音质：立即压回暂停（淡入刚起即被按住，几乎无感）
      await usePlayerStore.getState().pause();
    }
    prefetchNearbySongs();
  } catch (error) {
    setError(error instanceof Error ? error.message : "切换音质失败");
    throw error;
  } finally {
    if (intent === playIntentSeq) {
      setLoading(false);
    }
  }
}

/**
 * 播放队列中的歌曲
 */
export async function playSong(song: MusicInfo): Promise<void> {
  usePlayerStore.getState().setQueuePlaybackContext();
  await playSongCore(song);
}

/**
 * 播放队列中的歌曲
 */
export async function playFromQueue(index: number, startPosition?: number): Promise<void> {
  const { playbackContext, queue } = usePlayerStore.getState();
  if (index < 0 || index >= queue.length) return;
  const song = queue[index];
  if (playbackContext.type === "personalFm") {
    usePlayerStore.getState().setPersonalFmBatchIndex(index);
  } else {
    usePlayerStore.setState({ currentIndex: index });
  }
  await playSongCore(song, startPosition);
}

/**
 * 批量添加到队列并播放
 */
export async function playQueue(songs: MusicInfo[], startIndex = 0): Promise<void> {
  const { setQueue } = usePlayerStore.getState();
  if (songs.length === 0) return;
  if (startIndex < 0 || startIndex >= songs.length) {
    startIndex = 0;
  }
  setQueue(songs, startIndex);
  await playSongCore(songs[startIndex]);
}

/**
 * 随机排序后批量添加到队列并播放
 */
export async function playShuffledQueue(songs: MusicInfo[]): Promise<void> {
  if (songs.length === 0) return;
  const shuffledSongs = [...songs];
  for (let i = shuffledSongs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledSongs[i], shuffledSongs[j]] = [shuffledSongs[j], shuffledSongs[i]];
  }
  await playQueue(shuffledSongs, 0);
}

/**
 * 播放下一首
 *
 * auto=true 为「非用户点击」的自动跳过（playbackService 里播放失败后的有限跳过）：
 * 已有切换在途时直接放弃本次，不排补跳——补跳语义是「用户连点要多跳一步」，
 * 自动跳过若也排进去会在用户手动切歌完成后凭空多跳一首。
 */
export async function playNext(auto = false): Promise<void> {
  if (auto && switchStepQueue.switching) return;
  const step = applySwitchStepRequest(switchStepQueue, "next");
  switchStepQueue = step.nextState;
  if (!step.startNow) return;
  try {
  const store = usePlayerStore.getState();
  const { playbackContext, queue, currentIndex, playMode, shuffleHistory, playedIndices, tempPlayList } = store;

  // 稍后播放：优先消费 tempPlayList 首曲（FM 上下文同样生效——插播即脱离 FM 推荐流，
  // 切回队列上下文，否则暂存区在 FM 里永远不被消费）。取出后插入主队列 currentIndex+1，
  // 播完自然回到「原本的下一首」逻辑（因为主队列指针只前进了一步）。
  if (tempPlayList.length > 0) {
    const { nextSong, tempPlayList: nextTempList } = dequeueTempPlayList(tempPlayList);
    if (nextSong) {
      const inserted = insertSongToPlayNext({ queue, currentIndex, song: nextSong });
      usePlayerStore.setState({
        queue: inserted.queue,
        currentIndex: inserted.currentIndex,
        tempPlayList: nextTempList,
        playbackContext: { type: "queue" },
      });
      // 空队列场景：insertSongToPlayNext 返回 currentIndex=0 且 queue=[nextSong]，直接播这首。
      const targetIndex = queue.length === 0 || currentIndex < 0 ? 0 : currentIndex + 1;
      await playFromQueue(targetIndex);
      return;
    }
  }

  if (playbackContext.type === "personalFm") {
    await playNextPersonalFmSong();
    return;
  }

  const next = getNextQueueNavigationState({
    queueLength: queue.length,
    currentIndex,
    playMode,
    shuffleHistory,
    playedIndices,
  });
  usePlayerStore.setState({ shuffleHistory: next.shuffleHistory, playedIndices: next.playedIndices });
  if (next.nextIndex == null) return;
  await playFromQueue(next.nextIndex);
  } finally {
    await completeQueuedSwitchStep();
  }
}

/**
 * 播放上一首
 */
export async function playPrevious(): Promise<void> {
  const step = applySwitchStepRequest(switchStepQueue, "prev");
  switchStepQueue = step.nextState;
  if (!step.startNow) return;
  try {
  const { playbackContext, queue, currentIndex, position, playMode, shuffleHistory } = usePlayerStore.getState();
  if (queue.length === 0) return;
  if (playbackContext.type === "personalFm") {
    if (position > 3) {
      await usePlayerStore.getState().seekTo(0);
      return;
    }
    const prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      await usePlayerStore.getState().seekTo(0);
      return;
    }
    usePlayerStore.getState().setPersonalFmBatchIndex(prevIndex);
    await playFromQueue(prevIndex);
    return;
  }
  const previous = getPreviousQueueNavigationState({
    queueLength: queue.length,
    currentIndex,
    position,
    playMode,
    shuffleHistory,
  });
  usePlayerStore.setState({ shuffleHistory: previous.shuffleHistory });
  if (previous.shouldRestartCurrent) {
    await usePlayerStore.getState().seekTo(0);
    return;
  }
  if (previous.previousIndex == null) return;
  await playFromQueue(previous.previousIndex);
  } finally {
    await completeQueuedSwitchStep();
  }
}

/**
 * 加载歌词
 */
export async function startPersonalFm(): Promise<MusicInfo[]> {
  const { songs, hasMore } = await getPersonalFmSongs();
  if (songs.length === 0) {
    throw new Error("暂无可播放的私人 FM");
  }
  const [currentSong, ...restSongs] = songs;
  usePlayerStore.getState().setPersonalFmContext({
    currentBatch: [currentSong],
    currentBatchIndex: 0,
    buffer: restSongs,
    hasMore,
  });
  await playSongCore(currentSong);
  return songs;
}

export async function playNextPersonalFmSong(): Promise<void> {
  const store = usePlayerStore.getState();
  const context = store.playbackContext;
  if (context.type !== "personalFm") {
    return;
  }
  const nextInBatchIndex = context.currentBatchIndex + 1;
  if (nextInBatchIndex < context.currentBatch.length) {
    usePlayerStore.setState({ currentIndex: nextInBatchIndex });
    usePlayerStore.getState().setPersonalFmContext({
      currentBatch: context.currentBatch,
      currentBatchIndex: nextInBatchIndex,
      buffer: context.buffer,
      hasMore: context.hasMore,
    });
    await playSongCore(context.currentBatch[nextInBatchIndex]);
    return;
  }
  let nextSong = store.shiftPersonalFmBuffer();
  if (!nextSong) {
    const result = await getPersonalFmSongs();
    if (result.songs.length === 0) {
      throw new Error("暂无更多私人 FM");
    }
    const [firstSong, ...restSongs] = result.songs;
    usePlayerStore.getState().setPersonalFmContext({
      currentBatch: result.songs,
      currentBatchIndex: 0,
      buffer: restSongs,
      hasMore: result.hasMore,
    });
    await playSongCore(firstSong);
    return;
  }
  // FM 历史上限：追加后超过 50 条时截断保留最新 50 条（对齐桌面端 fmHistory 上限），
  // 防止 currentBatch 随切歌无限增长（currentBatchIndex 始终指向末尾，截断只丢最旧记录）。
  const nextBatch = [...context.currentBatch, nextSong].slice(-FM_HISTORY_MAX);
  const refreshedContext = usePlayerStore.getState().playbackContext;
  const nextBuffer = refreshedContext.type === "personalFm" ? refreshedContext.buffer : [];
  usePlayerStore.getState().setPersonalFmContext({
    currentBatch: nextBatch,
    currentBatchIndex: nextBatch.length - 1,
    buffer: nextBuffer,
    hasMore: context.hasMore,
  });
  await playSongCore(nextSong);
  const latestContext = usePlayerStore.getState().playbackContext;
  if (latestContext.type === "personalFm" && latestContext.buffer.length < 2 && latestContext.hasMore) {
    // 播后 buffer<2 时补拉推荐，失败不再静默：warn + 延迟 1s 轻量重试一次（重试失败仅 warn）
    const refillFmBuffer = async (warnPrefix: string): Promise<void> => {
      try {
        const refill = await getPersonalFmSongs();
        usePlayerStore.getState().appendPersonalFmBuffer(refill.songs, refill.hasMore);
      } catch (err) {
        console.warn(warnPrefix, err);
      }
    };
    try {
      const refill = await getPersonalFmSongs();
      usePlayerStore.getState().appendPersonalFmBuffer(refill.songs, refill.hasMore);
    } catch (err) {
      console.warn("[FM] 补拉推荐失败", err);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await refillFmBuffer("[FM] 补拉推荐重试失败");
    }
  }
}

export async function dislikeCurrentPersonalFmSong(): Promise<void> {
  const store = usePlayerStore.getState();
  const { currentSong, playbackContext } = store;
  if (!currentSong || playbackContext.type !== "personalFm") {
    throw new Error("当前不是私人 FM 播放");
  }
  await trashPersonalFmSong(currentSong.id);
  store.markCurrentPersonalFmSongSkipped();
  await playNextPersonalFmSong();
}

/**
 * 加载当前曲歌词。
 * intent 为发起时的 playIntentSeq 快照：歌词链路（缓存/网络）可达数秒，
 * 快速连切时旧请求的响应必须整体丢弃（含失败分支的 setLyrics([])），
 * 否则慢响应会覆盖新曲歌词造成音词错位。
 */
async function loadLyrics(song: MusicInfo, intent: number): Promise<void> {
  try {
    const { setLyrics } = usePlayerStore.getState();
    // 1. 尝试从缓存加载
    const cachedLyrics = await getCachedLyrics(song);
    if (cachedLyrics && cachedLyrics.length > 0) {
      if (intent !== playIntentSeq) return;
      setLyrics(cachedLyrics);
      return;
    }
    // 2. 从网络获取
    const lyrics = await getLyrics(song);
    if (intent !== playIntentSeq) return;
    setLyrics(lyrics);
    // 3. 缓存歌词
    if (lyrics.length > 0) {
      await cacheLyrics(song, lyrics);
    }
  } catch (error) {
    if (intent !== playIntentSeq) return;
    usePlayerStore.getState().setLyrics([]);
  }
}

/**
 * 格式化时间（秒 -> mm:ss）
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/** 行切换滞后带（秒）：前进进入新行需越过行起点 0.12s 才确认，对齐桌面 playbackSync.findCurrentLyricLine */
const LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS = 0.12;

/**
 * 获取当前歌词行索引
 */
export function getCurrentLyricIndex(
  lyrics: Array<{ time: number; text: string }>,
  position: number
): number {
  if (lyrics.length === 0) return -1;
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (position >= lyrics[i].time) {
      // 滞后带：仅对「前进进入新行」生效——越过该行起点 0.12s 才确认切换，
      // 吸收进度插值在行边界附近的锯齿；回退（seek 往回落在行中部）立即生效不受影响
      if (i > 0 && position - lyrics[i].time < LYRIC_LINE_ADVANCE_HYSTERESIS_SECONDS) {
        return i - 1;
      }
      return i;
    }
  }
  return -1;
}
