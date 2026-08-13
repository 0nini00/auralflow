import { formatTime } from "@/utils/formatTime";

/** 将秒数格式化为 m:ss（如 3:05）。非有限正数返回 0:00 */
export function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return "0:00";
  return formatTime(seconds);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
