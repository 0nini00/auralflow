/**
 * 字节数 → 人类可读（B/KB/MB/GB）。
 *
 * DownloadsView 与设置页此前各写一份循环，连小数位规则都渐渐不一样了。
 * `missing` 用于区分「没有数据」（显示占位文案）与「确认为 0」。
 */
export function formatBytes(bytes: number | null | undefined, missing = "--"): string {
  if (bytes == null) return missing;
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
