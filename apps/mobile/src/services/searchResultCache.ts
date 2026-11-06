import { createSearchResultCache, DEFAULT_SEARCH_CACHE_TTL_MS, type SearchCacheOptions, type SearchCacheParams } from '@lx/core';

export const DEFAULT_CACHE_TTL = DEFAULT_SEARCH_CACHE_TTL_MS;
export const DEFAULT_CACHE_LIMIT = 24;

/** 保留移动调用约定；来源与 namespace 分开入键，避免分隔符或分页结果相互覆盖。 */
export function createMobileSearchResultCache(options: Partial<SearchCacheOptions> = {}) {
  const cache = createSearchResultCache<unknown>({ ...options, maxEntries: options.maxEntries ?? DEFAULT_CACHE_LIMIT });
  const context = (source: string, namespace: string, params: SearchCacheParams) => ({ ...params, source, namespace });
  function getCachedResult<T>(source: string, keyword: string, namespace = 'default', params: SearchCacheParams = {}): T | null {
    return cache.get(keyword, context(source, namespace, params)) as T | null;
  }
  return {
    getCachedResult,
    setCachedResult<T>(source: string, keyword: string, result: T, namespace = 'default', ttl = options.ttlMs ?? DEFAULT_CACHE_TTL, params: SearchCacheParams = {}): void {
      cache.set(keyword, result, context(source, namespace, params), ttl);
    },
    clearCache() { cache.clear(); },
    clearCacheBySource(source: string) { cache.clear({ source }); },
  };
}

export const { getCachedResult, setCachedResult, clearCache, clearCacheBySource } = createMobileSearchResultCache();
