/**
 * 已缓存音频列表的纯逻辑：索引与磁盘文件的对齐、文件名解析、排序。
 *
 * 音频缓存文件名格式：{source}-{id}-{quality}.audio（不含歌曲名），
 * 歌曲元数据由 cacheService 维护在 AsyncStorage 索引里；
 * 索引可能落后（旧版本缓存/LRU 直接删文件/清缓存），列表展示前需对齐。
 */

export interface AudioCacheIndexEntry {
  name: string;
  singer: string;
  source: string;
  quality: string;
  path: string;
  cachedAt: number;
}

export interface CachedAudioEntry {
  /** 缓存文件名去掉扩展名，即 {source}-{id}-{quality} */
  key: string;
  name: string;
  singer: string;
  source: string;
  quality: string;
  path: string;
  size: number;
  cachedAt: number;
}

export interface AudioCacheFileOnDisk {
  /** 不含扩展名的文件名 base */
  base: string;
  path: string;
  size: number;
}

/** 解析 {source}-{id}-{quality} 三段式 base；id 本身允许包含 -（中段合并） */
export function parseAudioCacheFileBase(base: string): {
  source: string;
  id: string;
  quality: string;
} | null {
  const parts = base.split("-");
  if (parts.length < 3) return null;
  const source = parts[0];
  const quality = parts[parts.length - 1];
  const id = parts.slice(1, -1).join("-");
  if (!source || !id || !quality) return null;
  return { source, id, quality };
}

/**
 * 把 AsyncStorage 索引与磁盘文件对齐：
 * - 文件存在且有索引 → 用索引元数据；
 * - 文件存在但索引缺失 → 用文件名解析兜底（名称留空，由 UI 显示降级文案）；
 * - 索引有但文件已丢（LRU 淘汰/手动删除）→ 归入 staleKeys 待清理。
 */
export function reconcileAudioCacheEntries(
  index: Record<string, AudioCacheIndexEntry>,
  files: AudioCacheFileOnDisk[],
): { entries: CachedAudioEntry[]; staleKeys: string[] } {
  const entries: CachedAudioEntry[] = [];
  for (const file of files) {
    const indexed = index[file.base];
    if (indexed) {
      entries.push({
        key: file.base,
        name: indexed.name,
        singer: indexed.singer,
        source: indexed.source,
        quality: indexed.quality,
        path: indexed.path || file.path,
        size: file.size,
        cachedAt: indexed.cachedAt,
      });
      continue;
    }
    const parsed = parseAudioCacheFileBase(file.base);
    if (!parsed) continue;
    entries.push({
      key: file.base,
      name: "",
      singer: "",
      source: parsed.source,
      quality: parsed.quality,
      path: file.path,
      size: file.size,
      cachedAt: 0,
    });
  }
  const diskBases = new Set(files.map((file) => file.base));
  const staleKeys = Object.keys(index).filter((key) => !diskBases.has(key));
  entries.sort((a, b) => b.cachedAt - a.cachedAt || a.key.localeCompare(b.key));
  return { entries, staleKeys };
}
