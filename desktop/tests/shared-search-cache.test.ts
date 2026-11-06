import { afterEach, expect, it, vi } from 'vitest';
import { createSearchResultCache } from '../src/services/search/searchResultCache';
import { getCachedResult, setCachedResult, clearCache, clearCacheBySource } from '../../apps/mobile/src/services/searchResultCache';
import { addSearchHistory, getSearchHistory, removeSearchHistory } from '../src/services/search/searchHistory';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearCache(); });
it('桌面默认缓存五分钟过期，过滤条件更新不续期', () => {
  vi.useFakeTimers();
  const cache = createSearchResultCache();
  cache.set('song', { result: {}, activeFilter: 'all' });
  vi.advanceTimersByTime(299_999);
  cache.updateFilter('song', 'wy');
  expect(cache.get('song')?.activeFilter).toBe('wy');
  vi.advanceTimersByTime(1);
  expect(cache.get('song')).toBeNull();
});
it('移动缓存关键词归一化，带分隔符的来源与namespace不会串结果', () => {
  setCachedResult('b:c', ' e\u0301\u200b ', 'one', 'a');
  setCachedResult('c', 'é', 'two', 'a:b');
  expect(getCachedResult('b:c', 'é', 'a')).toBe('one');
  expect(getCachedResult('c', 'é', 'a:b')).toBe('two');
  clearCacheBySource('b');
  expect(getCachedResult('b:c', 'é', 'a')).toBe('one');
});
it('桌面历史按统一关键词规则读取、添加和删除', () => {
  const stored = new Map<string, string>([['af-search-history', JSON.stringify(['é', 'e\u0301', ' x ', 1])]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) });
  expect(getSearchHistory()).toEqual(['é', 'x']);
  addSearchHistory('\u200b x');
  expect(getSearchHistory()).toEqual(['x', 'é']);
  removeSearchHistory(' e\u0301 ');
  expect(getSearchHistory()).toEqual(['x']);
});
