/**
 * 缓存容量上限的 LRU 淘汰纯逻辑（无 RN 依赖，便于单测）。
 * cacheService 里的缓存按文件 mtime 近似访问时间，容量超过上限时淘汰最旧文件。
 */

export interface CachedFileEntry {
  path: string;
  size: number;
  /** 文件修改时间（毫秒时间戳），用于近似访问时间排序 */
  mtime: number;
}

/**
 * 选择需要删除的文件：当总字节数超过 maxBytes 时，按最旧 mtime 优先删除，
 * 直到剩余总大小不超过上限。已在上限内或空列表时返回空数组（不改动任何文件）。
 *
 * 注：若单个文件体积 > 上限，会先删更旧的文件，必要时同样删除该大文件以尽量回落。
 */
export function selectFilesToEvict(
  files: readonly CachedFileEntry[],
  maxBytes: number,
): string[] {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= maxBytes || files.length === 0) return [];

  const sorted = [...files].sort((a, b) => a.mtime - b.mtime);
  const evict: string[] = [];
  let remaining = total;

  for (const file of sorted) {
    if (remaining <= maxBytes) break;
    evict.push(file.path);
    remaining -= file.size;
  }

  return evict;
}