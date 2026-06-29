import type { MusicInfo } from '@lx/core';
import { loadSettings } from '@lx/tauri-bridge';
import { builtinNeteaseBackend } from './builtinNeteaseBackend';
import { customSourceBackend } from './customSourceBackend';
import type { PlaybackBackendId, PlaybackResolvedUrl } from './types';
import { canResolveWithBuiltinMusicApi } from '@/services/builtinMusicApiModel';

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
): Promise<PlaybackResolvedUrl> {
  const settings = await loadSettings();
  const qualityPreference = normalizeQualityPreference(preferredQuality ?? settings.defaultQuality);
  const allVariants = variants?.length ? variants : [music];
  const hasBuiltinApiVariant = allVariants.some(canResolveWithBuiltinMusicApi);
  let builtInError: unknown;

  if (hasBuiltinApiVariant) {
    try {
      return await builtinNeteaseBackend.resolve({
        primary: music,
        variants: allVariants,
        qualityPreference,
      });
    } catch (error) {
      builtInError = error;
    }
  }

  try {
    return await customSourceBackend.resolve({
      primary: music,
      variants: allVariants,
      qualityPreference,
    });
  } catch (fallbackError) {
    if (builtInError) {
      const builtInMessage = builtInError instanceof Error ? builtInError.message : String(builtInError);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`内置音乐 API 播放失败：${builtInMessage}\n自定义音源播放失败：${fallbackMessage}`);
    }
    throw fallbackError;
  }
}

export type { PlaybackBackendId, PlaybackResolvedUrl };
