export const DEFAULT_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
export type SearchCacheParams = Readonly<Record<string, string | number | boolean | null | undefined>>;
export interface SearchCacheOptions {
  maxEntries: number;
  ttlMs?: number;
  now?: () => number;
}

export function normalizeSearchKeyword(keyword: string): string {
  return keyword.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').normalize('NFC').trim();
}

export function dedupeSearchHistory(history: readonly string[], limit = 10): string[] {
  if (limit <= 0) return [];
  const unique = new Set<string>();
  for (const raw of history) {
    const item = normalizeSearchKeyword(raw);
    if (item) unique.add(item);
    if (unique.size >= limit) break;
  }
  return [...unique];
}

export function updateSearchHistory(history: readonly string[], keyword: string, limit = 10): string[] {
  return dedupeSearchHistory([keyword, ...history], limit);
}

/** 参数按键排序后序列化，避免来源、分类、分页或分隔符相同造成结果串用。 */
function cacheKey(keyword: string, params: SearchCacheParams): string {
  return JSON.stringify([keyword, Object.entries(params).filter(([, value]) => value !== undefined).sort(([left], [right]) => left.localeCompare(right))]);
}

export function createSearchResultCache<T>({ maxEntries, ttlMs = DEFAULT_SEARCH_CACHE_TTL_MS, now = () => Date.now() }: SearchCacheOptions) {
  const entries = new Map<string, { value: T; expiresAt: number; params: SearchCacheParams }>();
  function read(keyword: string, params: SearchCacheParams) {
    const key = cacheKey(normalizeSearchKeyword(keyword), params);
    const entry = entries.get(key);
    if (!entry) return null;
    if (now() >= entry.expiresAt) { entries.delete(key); return null; }
    entries.delete(key);
    entries.set(key, entry);
    return entry;
  }
  return {
    get(keyword: string, params: SearchCacheParams = {}): T | null {
      return read(keyword, params)?.value ?? null;
    },
    set(keyword: string, value: T, params: SearchCacheParams = {}, lifetimeMs = ttlMs): void {
      const normalized = normalizeSearchKeyword(keyword);
      if (!normalized || maxEntries <= 0) return;
      const key = cacheKey(normalized, params);
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + lifetimeMs, params: { ...params } });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
    update(keyword: string, update: (current: T) => T, params: SearchCacheParams = {}): void {
      const entry = read(keyword, params);
      if (entry) entry.value = update(entry.value);
    },
    clear(params?: SearchCacheParams): void {
      if (!params) { entries.clear(); return; }
      for (const [key, entry] of entries) {
        if (Object.entries(params).every(([name, value]) => entry.params[name] === value)) entries.delete(key);
      }
    },
  };
}
