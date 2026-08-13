import type { MusicInfo } from '@lx/core';
import { loadSettings } from '@lx/tauri-bridge';
import { builtinNeteaseBackend } from './builtinNeteaseBackend';
import { builtinProviderBackend } from './builtinProviderBackend';
import { customSourceBackend } from './customSourceBackend';
import type { PlaybackBackendId, PlaybackResolvedUrl } from './types';
import { canResolveWithBuiltinMusicApi } from '@/services/builtinMusicApiModel';
import { getCachedPlaybackUrl, saveCachedPlaybackUrl } from '@/services/persistentCache';
import { cacheResolvedPlaybackMedia } from '@/services/mediaCache';

function normalizeQualityPreference(value: string): string[] {
  if (value === 'high') return ['320k', '128k'];
  if (value === 'medium') return ['192k', '128k'];
  if (value === 'low') return ['128k'];
  if (value === 'flac24bit') return ['flac24bit', 'flac', '320k', '128k'];
  if (value === 'flac') return ['flac', '320k', '128k'];
  if (value === '320k') return ['320k', '128k'];
  if (value === '128k') return ['128k'];
  return ['320k', '128k'];
}

export async function resolvePlaybackUrl(
  music: MusicInfo,
  variants?: MusicInfo[],
  preferredQuality?: string,
  options: { bypassCache?: boolean; cacheMedia?: boolean } = {},
): Promise<PlaybackResolvedUrl> {
  const settings = await loadSettings();
  const qualityPreference = normalizeQualityPreference(preferredQuality ?? settings.defaultQuality);
  const allVariants = variants?.length ? variants : [music];
  const cacheVariants = allVariants.some((item) => item.source === music.source && item.id === music.id)
    ? allVariants
    : [music, ...allVariants];
  const hasBuiltinApiVariant = allVariants.some(canResolveWithBuiltinMusicApi);
  let builtInError: unknown;

  if (!options.bypassCache) {
    try {
      const cached = await getCachedPlaybackUrl(music, qualityPreference, cacheVariants);
      if (cached) return cached;
    } catch (error) {
    }
  }

  if (hasBuiltinApiVariant) {
    try {
      const resolved = await builtinNeteaseBackend.resolve({
        primary: music,
        variants: allVariants,
        qualityPreference,
      });
      const playable = await prepareResolvedPlaybackMedia(music, resolved, options.cacheMedia !== false);
      void saveCachedPlaybackUrl(music, playable).catch(() => undefined);
      return playable;
    } catch (error) {
      builtInError = error;
    }
  }

  try {
    const resolved = await builtinProviderBackend.resolve({
      primary: music,
      variants: allVariants,
      qualityPreference,
    });
    const playable = await prepareResolvedPlaybackMedia(music, resolved, options.cacheMedia !== false);
    void saveCachedPlaybackUrl(music, playable).catch(() => undefined);
    return playable;
  } catch (providerError) {
    if (builtInError) {
      const builtInMessage = builtInError instanceof Error ? builtInError.message : String(builtInError);
      const providerMessage = providerError instanceof Error ? providerError.message : String(providerError);
      builtInError = new Error(`内置音乐 API 播放失败：${builtInMessage}\n内置音源播放失败：${providerMessage}`);
    } else {
      builtInError = providerError;
    }
  }

  try {
    const resolved = await customSourceBackend.resolve({
      primary: music,
      variants: allVariants,
      qualityPreference,
    });
    const playable = await prepareResolvedPlaybackMedia(music, resolved, options.cacheMedia !== false);
    void saveCachedPlaybackUrl(music, playable).catch(() => undefined);
    return playable;
  } catch (fallbackError) {
    if (builtInError) {
      const builtInMessage = builtInError instanceof Error ? builtInError.message : String(builtInError);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`${builtInMessage}\n自定义音源播放失败：${fallbackMessage}`);
    }
    throw fallbackError;
  }
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
