import { createSearchResultCache as createCache, type SearchCacheOptions, type SearchCacheParams, type SearchResult } from '@lx/core';

export interface SearchResultCacheEntry {
  result: SearchResult;
  activeFilter: string;
}

export function createSearchResultCache(options: number | Partial<SearchCacheOptions> = 12) {
  const settings = typeof options === 'number' ? { maxEntries: options } : options;
  const cache = createCache<SearchResultCacheEntry>({ ...settings, maxEntries: settings.maxEntries ?? 12 });
  return {
    get: cache.get,
    set: cache.set,
    updateFilter(key: string, activeFilter: string, params: SearchCacheParams = {}) {
      cache.update(key, (entry) => ({ ...entry, activeFilter }), params);
    },
    clear: cache.clear,
  };
}

export type SearchResultCache = ReturnType<typeof createSearchResultCache>;
export const searchResultCache = createSearchResultCache();
