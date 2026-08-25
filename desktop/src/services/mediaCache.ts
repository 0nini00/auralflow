import type { MusicInfo } from '@lx/core';
import { COVER_SIZE_LARGE, resizeCoverUrl } from '@lx/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { cacheRemoteAudio, cacheRemoteImage, lookupCachedMedia } from '@lx/tauri-bridge';
import type { PlaybackResolvedUrl } from '@/services/playback/types';

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

async function cacheMusicCover(music: MusicInfo): Promise<MusicInfo> {
  const coverUrl = getCoverUrl(music);
  if (!isHttpUrl(coverUrl)) return music;

  // 缓存播放器用的大图而非原图：图床原图常有数 MB，实测缓存里出现过 4MB 的样本。
  const remoteUrl = resizeCoverUrl(coverUrl, COVER_SIZE_LARGE);
  const cacheKey = buildMediaCacheKey(music, 'cover');

  try {
    const cached = await lookupCachedMedia('cover', cacheKey);
    if (cached) {
      const localCoverUrl = convertFileSrc(cached);
      return { ...music, picUrl: localCoverUrl, img: localCoverUrl };
    }
  } catch {
    // 查缓存失败不影响播放，继续用远端地址
  }

  // 未命中：不等下载，后台落盘供下次使用
  void cacheRemoteImage({ url: remoteUrl, cacheKey }).catch(() => undefined);
  return { ...music, picUrl: remoteUrl, img: remoteUrl };
}

async function cachePlaybackAudio(music: MusicInfo, resolved: PlaybackResolvedUrl): Promise<string> {
  if (!CACHEABLE_AUDIO_SOURCES.has(music.source) || !isHttpUrl(resolved.url)) {
    return resolved.url;
  }

  const cacheKey = buildMediaCacheKey(music, `audio-${resolved.quality}`);

  try {
    // 已落盘：直接放本地文件，秒开且离线可用
    const cached = await lookupCachedMedia('audio', cacheKey);
    if (cached) return convertFileSrc(cached);
  } catch {
    // 查缓存失败就按未命中处理
  }

  // 未落盘：立即用远端地址播放，后台下载供下次使用。
  // 这里绝不能 await —— 等整首歌下载完再播放会让每次切歌卡住十几秒。
  void cacheRemoteAudio({ url: resolved.url, cacheKey }).catch(() => undefined);
  return resolved.url;
}

export async function cacheResolvedPlaybackMedia(
  primary: MusicInfo,
  resolved: PlaybackResolvedUrl,
): Promise<PlaybackResolvedUrl> {
  const targetMusic = mergeResolvedMusic(primary, resolved.music ?? primary);
  // 封面与音频互不依赖，并行处理；两者都只查缓存，不阻塞在下载上。
  const [musicWithCachedCover, cachedAudioUrl] = await Promise.all([
    cacheMusicCover(targetMusic),
    cachePlaybackAudio(targetMusic, resolved),
  ]);

  return {
    ...resolved,
    url: cachedAudioUrl,
    music: musicWithCachedCover,
  };
}
