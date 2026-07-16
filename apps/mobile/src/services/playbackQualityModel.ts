export type PlaybackQuality = "128k" | "192k" | "320k" | "flac" | "flac24bit";

export const DEFAULT_PLAYBACK_QUALITY: PlaybackQuality = "320k";

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

const QUALITY_ALIASES: Record<string, PlaybackQuality> = {
  "128": "128k",
  "128k": "128k",
  "192": "192k",
  "192k": "192k",
  "320": "320k",
  "320k": "320k",
  high: "320k",
  flac: "flac",
  hires: "flac24bit",
  "hi-res": "flac24bit",
  flac24bit: "flac24bit",
};

export function normalizePlaybackQuality(value: unknown): PlaybackQuality {
  if (typeof value !== "string") return DEFAULT_PLAYBACK_QUALITY;
  const normalized = value.trim().toLowerCase();
  return QUALITY_ALIASES[normalized] ?? DEFAULT_PLAYBACK_QUALITY;
}

export function resolveEffectivePlaybackQuality(
  songQuality?: string | null,
  preferredQuality?: string | null,
): PlaybackQuality {
  if (preferredQuality) return normalizePlaybackQuality(preferredQuality);
  if (songQuality) return normalizePlaybackQuality(songQuality);
  return DEFAULT_PLAYBACK_QUALITY;
}

/** 音质从低到高的有序表，用于生成降级候选。 */
const QUALITY_LADDER: readonly PlaybackQuality[] = ["128k", "192k", "320k", "flac", "flac24bit"];

/**
 * 把目标音质展开为"从目标逐级降到最低"的候选序列，用于弱网或无损不可用时自动回退。
 * 例：flac -> [flac, 320k, 192k, 128k]；128k -> [128k]。
 * 与桌面端 normalizeQualityPreference 的降级语义一致。
 */
export function getPlaybackQualityFallbacks(quality?: string | null): PlaybackQuality[] {
  const target = normalizePlaybackQuality(quality);
  const targetIndex = QUALITY_LADDER.indexOf(target);
  if (targetIndex < 0) return [DEFAULT_PLAYBACK_QUALITY];
  const candidates: PlaybackQuality[] = [];
  for (let i = targetIndex; i >= 0; i -= 1) {
    candidates.push(QUALITY_LADDER[i]);
  }
  return candidates;
}

export function getPlaybackQualityLabel(quality: string): string {
  const normalized = normalizePlaybackQuality(quality);
  return PLAYBACK_QUALITY_OPTIONS.find((option) => option.value === normalized)?.label ?? "高品质 320K";
}
