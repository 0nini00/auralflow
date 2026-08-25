import {
  DEFAULT_PLAYBACK_QUALITY,
  buildPlaybackQualityTiers,
  getPlaybackQualityFallbacks,
  getPlaybackQualityRank,
  getQualitiesAtOrAbove,
  normalizePlaybackQuality,
  type PlaybackQuality,
} from "@lx/core";

/**
 * 音质序关系、归一化与降级链的唯一真相源在 @lx/core/playback-quality，双端共用。
 * 这里只保留移动端 UI 文案与依赖本地设置的取值逻辑。
 */
export {
  DEFAULT_PLAYBACK_QUALITY,
  buildPlaybackQualityTiers,
  getPlaybackQualityFallbacks,
  getPlaybackQualityRank,
  getQualitiesAtOrAbove,
  normalizePlaybackQuality,
};
export type { PlaybackQuality };

export const PLAYBACK_QUALITY_OPTIONS: Array<{
  value: PlaybackQuality;
  label: string;
  description: string;
}> = [
  { value: "128k", label: "标准 128K", description: "体积小，弱网更稳" },
  { value: "192k", label: "较高 192K", description: "日常听感均衡" },
  { value: "320k", label: "高品质 320K", description: "优先高码率 MP3" },
  { value: "flac", label: "无损 FLAC", description: "优先无损音质" },
  { value: "flac24bit", label: "Hi-Res", description: "优先高解析度" },
];

export function resolveEffectivePlaybackQuality(
  songQuality?: string | null,
  preferredQuality?: string | null,
): PlaybackQuality {
  if (preferredQuality) return normalizePlaybackQuality(preferredQuality);
  if (songQuality) return normalizePlaybackQuality(songQuality);
  return DEFAULT_PLAYBACK_QUALITY;
}

export function getPlaybackQualityLabel(quality: string): string {
  const normalized = normalizePlaybackQuality(quality);
  return PLAYBACK_QUALITY_OPTIONS.find((option) => option.value === normalized)?.label ?? "高品质 320K";
}
