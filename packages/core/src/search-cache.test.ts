import { describe, expect, it } from 'vitest';
import { createSearchResultCache, normalizeSearchKeyword, updateSearchHistory, dedupeSearchHistory } from './index';

describe('跨端搜索缓存与关键词', () => {
  it('NFC 与零宽字符统一为同一个关键词，空白不缓存', () => {
    const cache = createSearchResultCache<string>({ maxEntries: 2 });
    cache.set('  e\u0301\u200b ', 'result');
    expect(cache.get('é')).toBe('result');
    cache.set('\u2060 ', 'empty');
    expect(cache.get('')).toBeNull();
    expect(normalizeSearchKeyword('\u200b 音乐 \ufeff')).toBe('音乐');
  });
  it('默认五分钟过期，读取与更新菜单过滤都不续期', () => {
    let now = 0;
    const cache = createSearchResultCache<number>({ maxEntries: 2, now: () => now });
    cache.set('song', 1);
    now = 299_999;
    expect(cache.get('song')).toBe(1);
    cache.update('song', () => 2);
    now = 300_000;
    expect(cache.get('song')).toBeNull();
    cache.update('song', () => 3);
    expect(cache.get('song')).toBeNull();
  });
  it('命中提升LRU顺序，容量与每条TTL可配置', () => {
    let now = 1;
    const cache = createSearchResultCache<number>({ maxEntries: 2, ttlMs: 100, now: () => now });
    cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
    expect(cache.get('b')).toBeNull();
    cache.set('d', 4, {}, 5);
    now = 6;
    expect(cache.get('d')).toBeNull();
    expect(cache.get('c')).toBe(3);
  });
  it('来源、分页和分类隔离，参数键顺序不影响命中', () => {
    const cache = createSearchResultCache<string>({ maxEntries: 12 });
    cache.set('song', 'first', { source: 'wy', page: 1, category: 'songs' });
    cache.set('song', 'second', { source: 'wy', page: 2, category: 'songs' });
    expect(cache.get('song', { category: 'songs', page: 1, source: 'wy' })).toBe('first');
    expect(cache.get('song', { source: 'wy', page: 2, category: 'songs' })).toBe('second');
    expect(cache.get('song', { source: 'tx', page: 1, category: 'songs' })).toBeNull();
    cache.clear({ source: 'wy' });
    expect(cache.get('song', { source: 'wy', page: 1, category: 'songs' })).toBeNull();
  });
  it('搜索历史统一去重、限制条数并保留最新关键词', () => {
    expect(updateSearchHistory(['é', 'e\u0301', ' x ', 'x'], '\u200b x ', 3)).toEqual(['x', 'é']);
    expect(dedupeSearchHistory([' a ', 'a', 'b'], 0)).toEqual([]);
    expect(dedupeSearchHistory([' a ', 'a', '\ufeff', 'b'], 2)).toEqual(['a', 'b']);
  });
});
