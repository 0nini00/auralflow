import type { MusicInfo } from '@lx/core';
import { COVER_TIER_IMMERSIVE, estimateStreamDurationSeconds, isPreviewStream, resizeCoverUrl } from '@lx/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { cacheRemoteAudio, cacheRemoteImage, lookupCachedMedia, removeCachedMedia, type CachedMedia } from '@lx/tauri-bridge';
import { logger } from '@/services/logger';
import { isLocalCachedPlaybackUrl } from '@/services/persistentCache';
import type { CustomSourceOperation } from '@/services/customSourceAccess';
import type { PlaybackBackendId, PlaybackResolvedUrl } from '@/services/playback/types';

export const CACHEABLE_AUDIO_SOURCES = new Set<MusicInfo['source']>(['wy', 'tx']);

function isHttpUrl(value: string | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

/**
 * 本地缓存条目不可用（文件被 LRU 淘汰 / 老命名 / 落盘的是试听片段）时抛出。
 *
 * 必须让调用方知道「这条持久化条目已经废了」—— 以前这里会回退到条目里的原地址，
 * 而原地址就是那个已经不存在的本地文件：播放器只会拿到一次 asset 协议 404 与一次失败。
 */
export class StalePlaybackCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StalePlaybackCacheError";
  }
}

function normalizeKeyPart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function buildMediaCacheKey(music: MusicInfo, kind: string): string {
  return `${normalizeKeyPart(music.source)}-${normalizeKeyPart(music.id)}-${normalizeKeyPart(kind)}`;
}

/** 音频缓存 key：`<source>-<id>-audio-<backend>-<quality>`（与 Rust 侧落盘文件名一致）。 */
export function buildAudioCacheKey(
  music: MusicInfo,
  backend: string,
  quality: string,
): string {
  return buildMediaCacheKey(music, `audio-${backend}-${quality}`);
}

/**
 * 旧版音频缓存 key：`<source>-<id>-audio-<quality>`，不带 backend（v0.6.8 之前）。
 *
 * 这批文件用新 key 永远查不到，但它们就是同一首歌、同一音质的完整落盘文件。
 * 播放本地文件不执行任何脚本，所以只需要在解析前把它们当作候选取一次。
 */
export function buildLegacyAudioCacheKey(music: MusicInfo, quality: string): string {
  return buildMediaCacheKey(music, `audio-${quality}`);
}

/**
 * 旧 key 没有 backend 信息，只能按曲目来源归属到内置后端。
 *
 * 这个值只用于日志 / trace / 播放后端标识，不参与缓存写入：
 * 命中旧文件后不会再补写一份新 key 的文件（那会把 2 GB 的缓存悄悄翻倍）。
 */
function legacyBackendOf(source: MusicInfo['source']): PlaybackBackendId {
  return source === 'tx' ? 'builtinProvider' : 'builtinNetease';
}

/**
 * 按落盘文件的扩展名推断「估算时长该用哪个码率」。
 *
 * 有损档刻意取该容器的最高码率：估出的时长偏长，最坏结果是漏判一个真试听片段
 * （播放期 `isPreviewDuration` 还会再判一次），而不是把一首好好的歌当残包删掉。
 */
function cachedFileQualityHint(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'flac':
    case 'wav':
      return 'flac';
    case 'mp3':
      return '320k';
    case 'm4a':
    case 'aac':
      return '192k';
    default:
      return undefined;
  }
}

function getCoverUrl(music: MusicInfo): string {
  return music.picUrl || music.img || '';
}

function mergeResolvedMusic(primary: MusicInfo, resolved: MusicInfo): MusicInfo {
  const coverUrl = getCoverUrl(resolved) || getCoverUrl(primary);
  const filteredResolved = Object.fromEntries(
    Object.entries(resolved).filter(([, v]) => v !== undefined),
  ) as MusicInfo;
  return {
    ...primary,
    ...filteredResolved,
    picUrl: resolved.picUrl || coverUrl || undefined,
    img: resolved.img || coverUrl || undefined,
  };
}

async function cacheMusicCover(music: MusicInfo, operation?: CustomSourceOperation): Promise<MusicInfo> {
  const coverUrl = getCoverUrl(music);
  if (!isHttpUrl(coverUrl)) return music;

  // 缓存播放器用的大图而非原图：图床原图常有数 MB，实测缓存里出现过 4MB 的样本。
  // 尺寸刻意不跟着显示场景变：缓存 key 只由 source/id 决定（见 buildMediaCacheKey），
  // 按场景分级会让播放条、沉浸页、系统媒体控制互相看不见对方落盘的图。
  // 600 是沉浸页封面的档位，也是所有展示位里最大的那个。
  const remoteUrl = resizeCoverUrl(coverUrl, COVER_TIER_IMMERSIVE);
  const cacheKey = buildMediaCacheKey(music, 'cover');

  let cached: CachedMedia | null = null;
  try {
    cached = await lookupCachedMedia('cover', cacheKey);
  } catch {
    // 查缓存失败不影响播放，继续用远端地址
  }
  operation?.assertActive();
  if (cached) {
    const localCoverUrl = convertFileSrc(cached.path);
    return { ...music, picUrl: localCoverUrl, img: localCoverUrl };
  }

  // 未命中：不等下载，后台落盘供下次使用
  void cacheRemoteImage({ url: remoteUrl, cacheKey }).catch(() => undefined);
  return { ...music, picUrl: remoteUrl, img: remoteUrl };
}

/**
 * 把已知的远端封面地址落盘到该曲目的封面缓存键（`<source>-<id>-cover`），返回可直接展示的
 * asset 地址；非 http(s) 地址、落盘失败都返回 null（不向外抛）。
 *
 * 复用 cacheMusicCover 的档位与 key 规则：曲目自带封面与自动匹配来的封面必须落在同一个
 * 文件上，否则播放条、沉浸页、系统媒体控制会各拿一份。
 *
 * 这里必须 await 落盘（旧实现是 fire-and-forget）：调用方要拿地址当场回填到正在播放的曲目，
 * 等下次播放才生效是用户可见的欠缺。不会拖慢任何用户可见路径 —— 两个调用点
 * （播放起播时的自动匹配、歌词匹配成功后的顺路兜底）都在 `void ...` 的后台任务里。
 */
export async function cacheCoverForMusic(music: MusicInfo, coverUrl: string): Promise<string | null> {
  if (!isHttpUrl(coverUrl)) return null;

  const cacheKey = buildMediaCacheKey(music, 'cover');
  try {
    // 已落过盘就不再下载一次（手动匹配与自动匹配可能先后指向同一个 key）
    const cached = await lookupCachedMedia('cover', cacheKey);
    if (cached) return convertFileSrc(cached.path);
  } catch {
    // 查缓存失败按未命中处理，继续走下载
  }

  try {
    const path = await cacheRemoteImage({
      url: resizeCoverUrl(coverUrl, COVER_TIER_IMMERSIVE),
      cacheKey,
    });
    return path ? convertFileSrc(path) : null;
  } catch {
    // 落盘失败静默：封面是可选装饰，不能影响播放或歌词
    return null;
  }
}

/**
 * 查询已落盘的封面缓存路径（只查缓存，不触发下载），供系统媒体控制推封面用。
 *
 * 刻意不看曲目当前的 picUrl：命中缓存时它已经被换成本地 asset 地址，
 * 但缓存 key 只由 source/id 决定，因此照样能查到同一个文件。
 * 未命中（含本地音乐）返回 null —— 此时系统侧只更新文字。
 */
export async function lookupCachedCoverPath(music: MusicInfo): Promise<string | null> {
  try {
    const cached = await lookupCachedMedia("cover", buildMediaCacheKey(music, "cover"));
    return cached?.path ?? null;
  } catch {
    // 查缓存失败不影响播放，按「没有封面」处理
    return null;
  }
}

export interface CacheResolvedMediaOptions {
  /**
   * 用指定的缓存 key 代替「backend + quality」拼出来的新 key。
   *
   * 目前唯一用途是旧命名文件（v0.6.8 前没有 backend 分区）：命中后仍走同一套
   * 残包校验与封面本地化，但读写都落在旧 key 上，不产生新的缓存文件。
   */
  cacheKey?: string;
  /**
   * 估算落盘文件时长时使用的音质档，默认用 `resolved.quality`。
   *
   * 旧命名 key 记的是**当时请求的音质**，不是文件真实码率（旧网关把 `br` 当档位用，
   * 缓存里甚至有 `audio-983` 这种键）。拿请求档位反推时长，会把「标 flac、实为 320k
   * 的短歌」估算成不足 60 秒，判成试听片段后直接删掉整曲。调用方按文件扩展名给出
   * 码率提示，宁可漏判（播放期还有 `isPreviewDuration` 兜底）也不能误删整曲。
   */
  previewQuality?: string;
}

async function cachePlaybackAudio(
  music: MusicInfo,
  resolved: PlaybackResolvedUrl,
  operation?: CustomSourceOperation,
  options?: CacheResolvedMediaOptions,
): Promise<string> {
  if (!CACHEABLE_AUDIO_SOURCES.has(music.source)) {
    return resolved.url;
  }

  const cacheKey = options?.cacheKey ?? buildAudioCacheKey(music, resolved.backend, resolved.quality);
  const previewQuality = options?.previewQuality ?? resolved.quality;
  // 「本地地址」不能只看协议：Windows 上 convertFileSrc 产出的是
  // `http://asset.localhost/<编码后的路径>`，isHttpUrl 会把它当成远端地址。
  const remoteUrl =
    isHttpUrl(resolved.url) && !isLocalCachedPlaybackUrl(resolved.url) ? resolved.url : null;

  let cached: CachedMedia | null = null;
  try {
    // 命中旧命名（v0.6.8 前不带 backend）时，options.cacheKey 就是那个旧 key：
    // 只读命中，不迁移、不复制；没给时按当前分区 key 查。
    cached = await lookupCachedMedia('audio', cacheKey);
  } catch {
    // 查缓存失败就按未命中处理
  }
  // 查询是异步的，失效后既不能返回本地文件，也不能发起新的原生下载。
  operation?.assertActive();

  if (cached) {
    // 磁盘上这份也可能是「试听片段」（同一首歌此前拿到过 30s 试听并落了盘）：
    // 解析期的探活判定只覆盖新地址，落盘文件必须靠体积离线判定，否则仍会出现
    //「播十几秒就跳」——播放器按实际时长判定试听 → 停播清缓存 → 自动下一首。
    // 云盘曲跳过这条判定：云盘不做转码，resolved.quality 是「请求档位」而文件是原码率，
    // 低码率上传（128k / 3.4MB / 223s）在 flac 档会被估算成 32s，判成试听片段后每次
    // 都把刚下好的文件删掉、日志刷一条警告，缓存永远命中不了。云盘文件是账号自己的
    // 完整文件，这条「落盘文件可能是 30s 试听」的判定对它不适用。
    if (
      music.wyCloud !== true &&
      isPreviewStream({
        totalBytes: cached.bytes,
        quality: previewQuality,
        expectedDurationSeconds: music.interval,
      })
    ) {
      const seconds = estimateStreamDurationSeconds(cached.bytes, previewQuality);
      logger.warn(
        `[cache] 磁盘缓存是试听片段（约 ${Math.round(seconds ?? 0)}s），已清除并改用远端地址: ${music.name}`,
      );
      await removeCachedMedia('audio', cacheKey).catch(() => undefined);
      operation?.assertActive();
      if (!remoteUrl) throw new StalePlaybackCacheError('磁盘缓存是试听片段');
      // 远端地址来自本次解析（解析期已做过试听判定），继续走下面的「先播远端」分支。
    } else {
      return convertFileSrc(cached.path);
    }
  }

  if (!remoteUrl) {
    // 待播地址本身就是本地文件（持久化条目里存的旧路径），而当前 key 查不到可用文件：
    // 文件可能早被 LRU 淘汰。旧命名（v0.6.8 前不分后端）由 findCachedPlaybackMedia
    // 作为解析前的候选兜底；解析进行到这里还查不到，就是文件真的不在了。
    // 把死链交给播放器只会得到一次 asset 协议 404 与一次失败，必须让上层作废该条目并重新解析。
    throw new StalePlaybackCacheError('本地缓存文件已不存在');
  }

  // 未落盘：立即用远端地址播放，后台下载供下次使用。
  // 这里绝不能 await —— 等整首歌下载完再播放会让每次切歌卡住十几秒。
  void cacheRemoteAudio({ url: remoteUrl, cacheKey }).catch(() => undefined);
  return remoteUrl;
}

export async function cacheResolvedPlaybackMedia(
  primary: MusicInfo,
  resolved: PlaybackResolvedUrl,
  operation?: CustomSourceOperation,
  options?: CacheResolvedMediaOptions,
): Promise<PlaybackResolvedUrl> {
  if (resolved.backend === 'customSource' && !operation) {
    throw new Error('LX 媒体缓存缺少操作令牌');
  }
  if (resolved.backend === 'hiddenSource' && !operation) {
    throw new Error('隐藏音源媒体缓存缺少操作令牌');
  }
  const access = resolved.backend === 'customSource' || resolved.backend === 'hiddenSource' ? operation : undefined;
  access?.assertActive();
  const targetMusic = mergeResolvedMusic(primary, resolved.music ?? primary);
  // 封面与音频互不依赖，并行处理；两者都只查缓存，不阻塞在下载上。
  const [musicWithCachedCover, cachedAudioUrl] = await Promise.all([
    cacheMusicCover(targetMusic, access),
    cachePlaybackAudio(targetMusic, resolved, access, options),
  ]);
  access?.assertActive();

  return {
    ...resolved,
    url: cachedAudioUrl,
    music: musicWithCachedCover,
  };
}

/** 音质阶梯（与 @lx/core PlaybackQuality 一致），按曲失效时需遍历各档缓存 key。 */
const AUDIO_CACHE_BACKENDS: readonly PlaybackBackendId[] = ['builtinNetease', 'builtinProvider', 'customSource', 'hiddenSource'];
const AUDIO_CACHE_QUALITIES = ["128k", "192k", "320k", "flac", "flac24bit"] as const;

/** 本地文件不是任何后端解析出来的，来源名单独标记，便于日志与排障。 */
const LOCAL_AUDIO_RESOLVER_NAME = '本地缓存';

/**
 * 在发起任何网络解析之前，先找「这首歌已经落盘的音频」。
 *
 * 为什么必须有这一步：持久化播放 URL 与音频文件是两套完全独立的缓存——
 * URL 只活 6 小时（还短于不少 CDN 签名地址的真实有效期），音频文件活 365 天。
 * 旧实现只在「URL 缓存命中」或「网络解析成功」之后才查媒体缓存，于是 URL 过期 /
 * 被用户清掉之后，即使整首歌就在磁盘上，也会先走完整网络解析；网络侧一旦失败
 * （歌被下架、VIP 变化、网关限流），播放就失败，表现正是「明明缓存过却播不了」。
 *
 * 候选按「音质降序 → 后端序」枚举；命中后仍走 `cacheResolvedPlaybackMedia`，
 * 由它完成试听残包判定、asset 地址转换与封面本地化，语义与正常解析完全一致。
 * 新分区全部未命中时再查一次旧命名 key（v0.6.8 前不带 backend）：那批文件在当前
 * 命名规则下永远查不到，但确实是同一首歌的完整落盘文件，不复用就只能重新下载。
 * 任何查询/校验失败都按未命中处理——本地缓存只是加速与兜底，不能反过来阻断播放。
 */
export async function findCachedPlaybackMedia(
  music: MusicInfo,
  qualityPreference: readonly string[],
  operation?: CustomSourceOperation,
): Promise<PlaybackResolvedUrl | null> {
  if (!CACHEABLE_AUDIO_SOURCES.has(music.source)) return null;

  const buildLocalResolution = (
    quality: string,
    backend: PlaybackBackendId,
  ): PlaybackResolvedUrl => ({
    url: '',
    music,
    quality,
    backend,
    resolverName: LOCAL_AUDIO_RESOLVER_NAME,
    fromCache: true,
    trace: [{
      backend,
      resolverName: LOCAL_AUDIO_RESOLVER_NAME,
      source: music.source,
      quality,
      status: 'success',
    }],
  });

  for (const quality of qualityPreference) {
    for (const backend of AUDIO_CACHE_BACKENDS) {
      // 自定义源被关闭/换代后不再复用其脚本落盘的音频，与 URL 缓存策略一致。
      if ((backend === 'customSource' || backend === 'hiddenSource') && !operation?.isActive()) continue;

      let cached: CachedMedia | null = null;
      try {
        cached = await lookupCachedMedia('audio', buildAudioCacheKey(music, backend, quality));
      } catch {
        continue;
      }
      if (!cached) continue;

      try {
        return await cacheResolvedPlaybackMedia(music, buildLocalResolution(quality, backend), operation);
      } catch (error) {
        // 落盘的是 30s 试听残包：cachePlaybackAudio 已删掉它，继续看下一档。
        if (error instanceof StalePlaybackCacheError) continue;
        // 生命周期失效等错误同样只跳过本地缓存，交给正常解析链决定。
        continue;
      }
    }

    // 旧命名兜底。刻意放在该音质的全部分区之后、且只读：
    // 不迁移、不复制、不改名——命中就直接播这个文件，下一次写缓存仍走新 key。
    // 旧 key 没有 backend 信息，归属按曲目来源猜（只看日志）；本地文件播放不执行脚本，
    // 因此也不受「自定义源是否开启」影响，但文件本身仍要过试听残包判定。
    const legacyKey = buildLegacyAudioCacheKey(music, quality);
    try {
      const legacy = await lookupCachedMedia('audio', legacyKey);
      if (legacy) {
        return await cacheResolvedPlaybackMedia(
          music,
          buildLocalResolution(quality, legacyBackendOf(music.source)),
          operation,
          { cacheKey: legacyKey, previewQuality: cachedFileQualityHint(legacy.path) },
        );
      }
    } catch {
      // 旧文件是试听残包（cachePlaybackAudio 已按 legacyKey 删掉）或查询异常，
      // 两种结局相同：按未命中处理，继续降档。
    }
  }
  return null;
}

/**
 * 按曲删除磁盘上的全部音频缓存（各音质档），用于试听片段 / 坏链的定向失效。
 *
 * 必须存在的原因：`cachePlaybackAudio` 命中磁盘缓存就直接放本地文件、不再过探活；
 * 只清持久化 URL 缓存不足以摆脱一个已落盘的试听片段——下次播放仍会命中它。
 * Rust 侧只有整体清空（`clear_media_cache`），所以只能逐档 key 调用。
 *
 * 旧命名 key 也要一起删：现在解析前会兜底命中它们，漏掉就会「删了缓存、下次还播同一个
 * 坏文件」——播放失败后的定向失效等于没有生效。
 */
export async function removeCachedAudioForMusic(music: MusicInfo): Promise<void> {
  await Promise.all([
    ...AUDIO_CACHE_BACKENDS.flatMap((backend) => AUDIO_CACHE_QUALITIES.map((quality) =>
      removeCachedMedia("audio", buildMediaCacheKey(music, `audio-${backend}-${quality}`)).catch(() => false),
    )),
    ...AUDIO_CACHE_QUALITIES.map((quality) =>
      removeCachedMedia("audio", buildLegacyAudioCacheKey(music, quality)).catch(() => false),
    ),
  ]);
}
