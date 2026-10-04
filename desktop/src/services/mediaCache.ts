import type { MusicInfo } from '@lx/core';
import { COVER_TIER_IMMERSIVE, resizeCoverUrl } from '@lx/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { cacheRemoteAudio, cacheRemoteImage, lookupCachedMedia, removeCachedMedia } from '@lx/tauri-bridge';
import type { CustomSourceOperation } from '@/services/customSourceAccess';
import type { PlaybackBackendId, PlaybackResolvedUrl } from '@/services/playback/types';

export const CACHEABLE_AUDIO_SOURCES = new Set<MusicInfo['source']>(['wy', 'tx']);

function isHttpUrl(value: string | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value);
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

  let cached: string | null = null;
  try {
    cached = await lookupCachedMedia('cover', cacheKey);
  } catch {
    // 查缓存失败不影响播放，继续用远端地址
  }
  operation?.assertActive();
  if (cached) {
    const localCoverUrl = convertFileSrc(cached);
    return { ...music, picUrl: localCoverUrl, img: localCoverUrl };
  }

  // 未命中：不等下载，后台落盘供下次使用
  void cacheRemoteImage({ url: remoteUrl, cacheKey }).catch(() => undefined);
  return { ...music, picUrl: remoteUrl, img: remoteUrl };
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
    return await lookupCachedMedia("cover", buildMediaCacheKey(music, "cover"));
  } catch {
    // 查缓存失败不影响播放，按「没有封面」处理
    return null;
  }
}

async function cachePlaybackAudio(
  music: MusicInfo,
  resolved: PlaybackResolvedUrl,
  operation?: CustomSourceOperation,
): Promise<string> {
  if (!CACHEABLE_AUDIO_SOURCES.has(music.source) || !isHttpUrl(resolved.url)) {
    return resolved.url;
  }

  const cacheKey = buildMediaCacheKey(music, `audio-${resolved.backend}-${resolved.quality}`);

  let cached: string | null = null;
  try {
    // 新 key 按 backend 分区；旧 key 来源不明，不复用也不主动删除。
    cached = await lookupCachedMedia('audio', cacheKey);
  } catch {
    // 查缓存失败就按未命中处理
  }
  // 查询是异步的，失效后既不能返回本地文件，也不能发起新的原生下载。
  operation?.assertActive();
  if (cached) return convertFileSrc(cached);

  // 未落盘：立即用远端地址播放，后台下载供下次使用。
  // 这里绝不能 await —— 等整首歌下载完再播放会让每次切歌卡住十几秒。
  void cacheRemoteAudio({ url: resolved.url, cacheKey }).catch(() => undefined);
  return resolved.url;
}

export async function cacheResolvedPlaybackMedia(
  primary: MusicInfo,
  resolved: PlaybackResolvedUrl,
  operation?: CustomSourceOperation,
): Promise<PlaybackResolvedUrl> {
  if (resolved.backend === 'customSource' && !operation) {
    throw new Error('LX 媒体缓存缺少操作令牌');
  }
  const access = resolved.backend === 'customSource' ? operation : undefined;
  access?.assertActive();
  const targetMusic = mergeResolvedMusic(primary, resolved.music ?? primary);
  // 封面与音频互不依赖，并行处理；两者都只查缓存，不阻塞在下载上。
  const [musicWithCachedCover, cachedAudioUrl] = await Promise.all([
    cacheMusicCover(targetMusic, access),
    cachePlaybackAudio(targetMusic, resolved, access),
  ]);
  access?.assertActive();

  return {
    ...resolved,
    url: cachedAudioUrl,
    music: musicWithCachedCover,
  };
}

/** 音质阶梯（与 @lx/core PlaybackQuality 一致），按曲失效时需遍历各档缓存 key。 */
const AUDIO_CACHE_BACKENDS: readonly PlaybackBackendId[] = ['builtinNetease', 'builtinProvider', 'customSource'];
const AUDIO_CACHE_QUALITIES = ["128k", "192k", "320k", "flac", "flac24bit"] as const;

/**
 * 按曲删除磁盘上的全部音频缓存（各音质档），用于试听片段 / 坏链的定向失效。
 *
 * 必须存在的原因：`cachePlaybackAudio` 命中磁盘缓存就直接放本地文件、不再过探活；
 * 只清持久化 URL 缓存不足以摆脱一个已落盘的试听片段——下次播放仍会命中它。
 * Rust 侧只有整体清空（`clear_song_cache`），所以只能逐档 key 调用。
 */
export async function removeCachedAudioForMusic(music: MusicInfo): Promise<void> {
  await Promise.all(
    AUDIO_CACHE_BACKENDS.flatMap((backend) => AUDIO_CACHE_QUALITIES.map((quality) =>
      removeCachedMedia("audio", buildMediaCacheKey(music, `audio-${backend}-${quality}`)).catch(() => false),
    )),
  );
}
