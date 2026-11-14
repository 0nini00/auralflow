// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { addSearchHistory, getSearchHistory } from '../src/services/search/searchHistory';
import { getStoredSearchKeywords } from '../src/services/search/searchSuggestions';

/**
 * 搜索关键词只能有一份存储（af-search-history）：搜索页历史列表与顶栏联想
 * 都从它派生。旧实现另存一个 af_recent_search_keywords，顶栏只写后者，
 * 于是「从顶栏搜过的词」不出现在搜索页历史里，清空/撤销也各管一半。
 */
beforeEach(() => {
  localStorage.clear();
});

describe('搜索关键词单一存储', () => {
  it('写进搜索历史的关键词，联想列表立即可见', () => {
    addSearchHistory('晴天');
    expect(getStoredSearchKeywords()).toEqual(['晴天']);
  });

  it('旧的 af_recent_search_keywords 一次性并入搜索历史并删除旧键', () => {
    localStorage.setItem('af_recent_search_keywords', JSON.stringify(['旧词', '更旧的词']));
    addSearchHistory('新词');

    expect(getStoredSearchKeywords()).toEqual(['新词', '旧词', '更旧的词']);
    expect(localStorage.getItem('af_recent_search_keywords')).toBeNull();
    expect(getSearchHistory()).toEqual(['新词', '旧词', '更旧的词']);
  });

  it('联想列表最多取 10 条', () => {
    for (let index = 0; index < 15; index += 1) addSearchHistory(`词${index}`);
    expect(getStoredSearchKeywords()).toHaveLength(10);
  });
});
