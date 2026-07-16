/**
 * 下载目录展示文案（纯函数，便于单测；不依赖 RNFS）。
 */

/** 把冗长沙盒路径收成更适合展示的短路径。 */
export function formatDownloadDirectoryLabel(path: string): string {
  if (!path) return "未就绪";
  const normalized = path.replace(/\\/g, "/");
  // 优先展示 auralflow/downloads 及其后的部分，避免整段 Document 路径占满屏幕
  const marker = "/auralflow/downloads";
  const idx = normalized.lastIndexOf(marker);
  if (idx >= 0) {
    return `…${normalized.slice(idx)}`;
  }
  if (normalized.length > 48) {
    return `…${normalized.slice(-45)}`;
  }
  return normalized;
}
