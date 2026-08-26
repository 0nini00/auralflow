/**
 * 播放流完整性判定：区分完整歌曲与 30s 试听片段。
 *
 * 竞速胜出的 URL 只校验「可播放」不足以保证「是完整版」——gdstudio 对无版权/
 * VIP 歌曲、wy eapi 无 VIP、自定义音源脚本都可能返回试听 URL，试听与完整版
 * 同样返回 200/206，甚至音质标签更高。双端在竞速后与播放器加载后共用本模块
 * 做时长判定，避免试听片段进播放器与缓存。
 */
import { normalizePlaybackQuality, type PlaybackQuality } from "./playback-quality";

/** 各音质档的标称码率（kbps），由字节数估算时长用。 */
const QUALITY_BITRATE_KBPS: Record<PlaybackQuality, number> = {
  "128k": 128,
  "192k": 192,
  "320k": 320,
  flac: 900,
  flac24bit: 2000,
};

/** 试听判定的保守上限：估算时长连该值都不到，且不足期望时长的一半时才判试听。 */
export const PREVIEW_MAX_DURATION_SECONDS = 60;

/** 实际/估算时长低于期望时长的该比例即视为试听片段。 */
export const PREVIEW_DURATION_FRACTION = 0.5;

/**
 * 从 Content-Range 响应头提取完整资源字节数。
 * 支持 "bytes 0-0/TOTAL" 与 "bytes 0-1/TOTAL"；总量为星号或非法串时返回 undefined。
 */
export function parseContentRangeTotal(contentRange: string): number | undefined {
  const match = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(contentRange.trim());
  if (!match) return undefined;
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

/**
 * 由完整字节数与音质码率估算流时长（秒）。
 * 缺 totalBytes / 码率未知时返回 null，由调用方跳过判定（不误伤）。
 */
export function estimateStreamDurationSeconds(
  totalBytes: number,
  quality: unknown,
): number | null {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  const bitrate = QUALITY_BITRATE_KBPS[normalizePlaybackQuality(quality)];
  if (!bitrate) return null;
  return (totalBytes * 8) / (bitrate * 1000);
}

/**
 * 解析期判定：由 HTTP 头里的完整字节数判断候选流是否为试听片段。
 *
 * 有期望时长（MusicInfo.interval）且能估算出流时长时才判定；两者任一缺失都返回
 * false，避免把短歌（intro / 1 分钟内的真歌曲）误判为试听。
 */
export function isPreviewStream(options: {
  totalBytes?: number | null;
  quality?: unknown;
  expectedDurationSeconds?: number | null;
}): boolean {
  const { totalBytes, quality, expectedDurationSeconds } = options;
  if (totalBytes == null || totalBytes <= 0) return false;
  if (expectedDurationSeconds == null || expectedDurationSeconds <= 0) return false;
  const estimated = estimateStreamDurationSeconds(totalBytes, quality);
  if (estimated == null) return false;
  const threshold = Math.min(
    PREVIEW_MAX_DURATION_SECONDS,
    expectedDurationSeconds * PREVIEW_DURATION_FRACTION,
  );
  return estimated < threshold;
}

/**
 * 播放期兜底判定：播放器解析出的实际流时长明显短于期望时长时视为试听。
 * 覆盖解析期拿不到 Content-Length / Content-Range 的流式响应（chunked）。
 */
export function isPreviewDuration(options: {
  actualDurationSeconds?: number | null;
  expectedDurationSeconds?: number | null;
}): boolean {
  const { actualDurationSeconds, expectedDurationSeconds } = options;
  if (actualDurationSeconds == null || actualDurationSeconds <= 0) return false;
  if (expectedDurationSeconds == null || expectedDurationSeconds <= 0) return false;
  return actualDurationSeconds < expectedDurationSeconds * PREVIEW_DURATION_FRACTION;
}
