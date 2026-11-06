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
export function collectSearchResults(states: MobileSearchState[]): SearchResults {
  return states.reduce((result, state) => mergeSearchPages(result, state.result), emptySearchResults());
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
