import { createPagedSearch, normalizeSearchKeyword, type SearchPageState } from '@lx/core';
import { emptySearchResults, searchCategoryPage, type SearchCategory, type SearchResults } from './musicApi';

export interface MobileSearchSource { id: string; category: SearchCategory; platform: 'wy' | 'tx' }
export type MobileSearchState = SearchPageState<MobileSearchSource, SearchResults>;

function unique<T extends { source: string; id: string }>(items: T[]): T[] {
  return [...new Map(items.map(item => [`${item.source}:${item.id}`, item])).values()];
}
export function mergeSearchPages(current: SearchResults, incoming: SearchResults): SearchResults {
  return {
    songs: unique([...current.songs, ...incoming.songs]),
    artists: unique([...current.artists, ...incoming.artists]),
    albums: unique([...current.albums, ...incoming.albums]),
    playlists: unique([...current.playlists, ...incoming.playlists]),
  };
}
/** 一次搜索会话只重建发生变化的分类，状态通知不使其它分类失去引用。 */
export function createSearchResultCollector(): (states: MobileSearchState[]) => SearchResults {
  let result = emptySearchResults();
  const inputs = new Map<SearchCategory, unknown[]>();
  return (states) => {
    let next = result;
    for (const category of ['songs', 'artists', 'albums', 'playlists'] as const) {
      const arrays = states.filter(state => state.source.category === category).map(state => state.result[category]);
      const previous = inputs.get(category);
      if (previous?.length === arrays.length && arrays.every((array, index) => array === previous[index])) continue;
      inputs.set(category, arrays);
      const items = unique<{ source: string; id: string }>(arrays.flat());
      const current = result[category];
      if (current.length === items.length && items.every((item, index) => item === current[index])) continue;
      if (next === result) next = { ...result };
      // category 与输入数组保持对应；四类条目只共用身份去重规则。
      Object.assign(next, { [category]: items });
    }
    result = next;
    return result;
  };
}
export function createMobileSearchSession(
  keyword: string,
  onChange?: (states: MobileSearchState[]) => void,
  request = searchCategoryPage,
) {
  const query = normalizeSearchKeyword(keyword);
  const sources: MobileSearchSource[] = ['wy', 'tx'].flatMap(platform =>
    (['songs', 'artists', 'albums', 'playlists'] as const)
      .filter(category => platform === 'wy' || category === 'songs' || category === 'playlists')
      .map(category => ({ id: `${platform}:${category}`, platform: platform as 'wy' | 'tx', category })),
  );
  const seen = new Map<string, Set<string>>();
  return createPagedSearch({ sources, empty: emptySearchResults, merge: mergeSearchPages, onChange,
    request: async (source, page) => {
      const response = await request(source.platform, source.category, query, page);
      const keys = seen.get(source.id) ?? new Set<string>();
      const items = response.result[source.category];
      const newItems = items.some(item => !keys.has(`${item.source}:${item.id}`));
      for (const item of items) keys.add(`${item.source}:${item.id}`);
      seen.set(source.id, keys);
      return { ...response, hasMore: response.hasMore && newItems };
    },
  });
}
