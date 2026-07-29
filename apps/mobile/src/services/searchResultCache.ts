/**
 * 移动端搜索结果缓存
 *
 * 参考桌面端 src/services/search/searchResultCache.ts 的 LRU 策略，
 * 并增加 TTL 过期机制：按 `namespace:source:keyword` 作为 key 缓存搜索结果，
 * 默认 5 分钟过期，同时保留最近若干条记录防止内存无限增长。
 */

/** 缓存条目 */
interface CacheEntry<T> {
  result: T;
  expireAt: number;
}

/** 默认 TTL：5 分钟 */
export const DEFAULT_CACHE_TTL = 5 * 60 * 1000;

/** 默认最大缓存条目数（LRU 上限） */
export const DEFAULT_CACHE_LIMIT = 24;

/**
 * 构造缓存 key。
 * 引入 namespace 以区分 searchSongs（MusicInfo[]）与 searchAll（SearchResults）
 * 这两类返回值，避免相同 source+keyword 下互相覆盖。
 */
function buildKey(namespace: string, source: string, keyword: string): string {
  return `${namespace}:${source}:${keyword.trim()}`;
}

/**
 * 获取缓存结果。
 * 命中且未过期时返回结果；过期或不存在时返回 null（并清理过期条目）。
 */
export function getCachedResult<T>(
  source: string,
  keyword: string,
  namespace = "default"
): T | null {
  const key = buildKey(namespace, source, keyword);
  const entry = cacheEntries.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  // TTL 过期：移除并视为未命中
  if (Date.now() > entry.expireAt) {
    cacheEntries.delete(key);
    return null;
  }

  // LRU：命中后重新插入到末尾，标记为最近使用
  cacheEntries.delete(key);
  cacheEntries.set(key, entry);
  return entry.result;
}

/**
 * 写入缓存结果。
 */
export function setCachedResult<T>(
  source: string,
  keyword: string,
  result: T,
  namespace = "default",
  ttl: number = DEFAULT_CACHE_TTL
): void {
  const key = buildKey(namespace, source, keyword);
  if (!keyword.trim()) return;

  // 已存在则先删除，保证 LRU 顺序
  cacheEntries.delete(key);
  cacheEntries.set(key, { result, expireAt: Date.now() + ttl });

  // 超出上限时淘汰最旧条目
  while (cacheEntries.size > DEFAULT_CACHE_LIMIT) {
    const oldestKey = cacheEntries.keys().next().value;
    if (!oldestKey) break;
    cacheEntries.delete(oldestKey);
  }
}

/**
 * 判断指定 source+keyword 是否存在有效缓存（未过期）。
 * 供 UI 层在不触发请求的情况下判断是否为"来自缓存"。
 */
export function hasCachedResult(
  source: string,
  keyword: string,
  namespace = "default"
): boolean {
  return getCachedResult(source, keyword, namespace) !== null;
}

/**
 * 清空全部缓存。
 */
export function clearCache(): void {
  cacheEntries.clear();
}

/**
 * 按 source 清空缓存（可选辅助方法）。
 */
export function clearCacheBySource(source: string): void {
  for (const key of Array.from(cacheEntries.keys())) {
    if (key.includes(`:${source}:`)) {
      cacheEntries.delete(key);
    }
  }
}

// 内部缓存存储，模块级单例
const cacheEntries = new Map<string, CacheEntry<unknown>>();
