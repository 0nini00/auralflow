import type { MusicInfo } from '@lx/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { cacheRemoteAudio, cacheRemoteImage } from '@lx/tauri-bridge';
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

  try {
    const path = await cacheRemoteImage({
      url: coverUrl,
      cacheKey: buildMediaCacheKey(music, 'cover'),
    });
    const localCoverUrl = convertFileSrc(path);
    return {
      ...music,
      picUrl: localCoverUrl,
      img: localCoverUrl,
    };
  } catch (error) {
    return music;
  }
}

async function cachePlaybackAudio(music: MusicInfo, resolved: PlaybackResolvedUrl): Promise<string> {
  if (!CACHEABLE_AUDIO_SOURCES.has(music.source) || !isHttpUrl(resolved.url)) {
    return resolved.url;
  }

  try {
    const path = await cacheRemoteAudio({
      url: resolved.url,
      cacheKey: buildMediaCacheKey(music, `audio-${resolved.quality}`),
    });
    return convertFileSrc(path);
  } catch (error) {
    return resolved.url;
  }
}

export async function cacheResolvedPlaybackMedia(
  primary: MusicInfo,
  resolved: PlaybackResolvedUrl,
): Promise<PlaybackResolvedUrl> {
  const targetMusic = mergeResolvedMusic(primary, resolved.music ?? primary);
  const musicWithCachedCover = await cacheMusicCover(targetMusic);
  const cachedAudioUrl = await cachePlaybackAudio(targetMusic, resolved);

  return {
    ...resolved,
    url: cachedAudioUrl,
    music: musicWithCachedCover,
  };
}
