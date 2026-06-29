import type { SearchResult } from "@lx/core";

export interface SearchResultCacheEntry {
  result: SearchResult;
  activeFilter: string;
}

export interface SearchResultCache {
  get: (key: string) => SearchResultCacheEntry | null;
  set: (key: string, entry: SearchResultCacheEntry) => void;
  updateFilter: (key: string, activeFilter: string) => void;
  clear: () => void;
}

export function createSearchResultCache(limit = 12): SearchResultCache {
  const entries = new Map<string, SearchResultCacheEntry>();

  const normalizeKey = (key: string) => key.trim();

  return {
    get(key) {
      const normalized = normalizeKey(key);
      const entry = entries.get(normalized);
      if (!entry) return null;
      entries.delete(normalized);
      entries.set(normalized, entry);
      return entry;
    },

    set(key, entry) {
      const normalized = normalizeKey(key);
      if (!normalized) return;
      entries.delete(normalized);
      entries.set(normalized, entry);
      while (entries.size > limit) {
        const oldestKey = entries.keys().next().value;
        if (!oldestKey) break;
        entries.delete(oldestKey);
      }
    },

    updateFilter(key, activeFilter) {
      const normalized = normalizeKey(key);
      const entry = entries.get(normalized);
      if (!entry) return;
      entries.delete(normalized);
      entries.set(normalized, { ...entry, activeFilter });
    },

    clear() {
      entries.clear();
    },
  };
}

export const searchResultCache = createSearchResultCache();
