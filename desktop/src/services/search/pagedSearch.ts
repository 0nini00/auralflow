import {
  createEmptySearchResult,
  countSearchResults,
  SEARCH_ALL_TYPES,
} from "@/services/search/searchAggregation";
import { createPagedSearch, type SearchPageState } from "@lx/core";
import type { MusicSource, SearchResult, SearchType } from "@lx/core";

export interface DesktopSearchSource {
  id: string;
  category: SearchType;
  provider: MusicSource;
}

export interface DesktopSearchSnapshot {
  states: SearchPageState<DesktopSearchSource, SearchResult>[];
  result: SearchResult;
}

function mergeItems<T extends { id: string; source: string }>(current: T[] = [], incoming: T[] = []): T[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map(item => `${item.source}:${item.id}`));
  const additions = incoming.filter(item => {
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return additions.length ? [...current, ...additions] : current;
}

function mergeUnique(current: SearchResult, incoming: SearchResult): SearchResult {
  return {
    songs: mergeItems(current.songs, incoming.songs),
    playlists: mergeItems(current.playlists, incoming.playlists),
    artists: mergeItems(current.artists, incoming.artists),
    albums: mergeItems(current.albums, incoming.albums),
  };
}

function createCategoryAggregator<T extends { id: string; source: string }>() {
  let previous: (T[] | undefined)[] = [];
  let result: T[] = [];
  return (inputs: (T[] | undefined)[]): T[] => {
    if (inputs.length === previous.length && inputs.every((items, index) => items === previous[index])) return result;
    previous = inputs;
    const next: T[] = [];
    const seen = new Set<string>();
    for (const items of inputs) {
      for (const item of items ?? []) {
        const key = `${item.source}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(item);
      }
    }
    if (next.length !== result.length || next.some((item, index) => item !== result[index])) result = next;
    return result;
  };
}

export function createDesktopSearchSession(
  keyword: string,
  providers: readonly MusicSource[],
  onChange?: (snapshot: DesktopSearchSnapshot) => void,
  initialStates?: readonly SearchPageState<DesktopSearchSource, SearchResult>[],
) {
  const sources: DesktopSearchSource[] = SEARCH_ALL_TYPES.flatMap((category) =>
    providers
      .filter((provider) => provider.supportedSearchTypes.includes(category))
      .map((provider) => ({ id: `${provider.id}:${category}`, category, provider })),
  );
  let latest: DesktopSearchSnapshot = { states: [], result: createEmptySearchResult() };
  const songs = createCategoryAggregator<NonNullable<SearchResult['songs']>[number]>();
  const playlists = createCategoryAggregator<NonNullable<SearchResult['playlists']>[number]>();
  const artists = createCategoryAggregator<NonNullable<SearchResult['artists']>[number]>();
  const albums = createCategoryAggregator<NonNullable<SearchResult['albums']>[number]>();
  const aggregate = (states: DesktopSearchSnapshot['states']): SearchResult => {
    const result = {
      songs: songs(states.map(state => state.result.songs)),
      playlists: playlists(states.map(state => state.result.playlists)),
      artists: artists(states.map(state => state.result.artists)),
      albums: albums(states.map(state => state.result.albums)),
    };
    const previous = latest.result;
    return result.songs === previous.songs && result.playlists === previous.playlists
      && result.artists === previous.artists && result.albums === previous.albums ? previous : result;
  };
  // 每个来源已经见过的条目。有些音源忽略 page 参数、反复返回同一页，
  // 只按“本页非空”判 hasMore 会让“加载更多”永远停不下来。
  const seenBySource = new Map<string, Set<string>>();
  const session = createPagedSearch<DesktopSearchSource, SearchResult>({
    sources,
    initialStates,
    empty: createEmptySearchResult,
    merge: mergeUnique,
    request: async (source, page) => {
      const result = await source.provider.search(keyword, source.category, page);
      const seen = seenBySource.get(source.id) ?? new Set<string>();
      seenBySource.set(source.id, seen);
      let addsNew = false;
      for (const items of [result.songs, result.playlists, result.artists, result.albums]) {
        for (const item of items ?? []) {
          const key = `${item.source}:${item.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          addsNew = true;
        }
      }
      // 旧音源未提供分页元数据时，用“这一页有没有新条目”收尾：整页重复即视为忽略 page。
      return { result, hasMore: result.hasMore ?? (countSearchResults(result) > 0 && addsNew) };
    },
    onChange: (states) => {
      const result = aggregate(states);
      latest = { states, result };
      onChange?.(latest);
    },
  });
  const states = session.getSnapshot();
  latest = { states, result: aggregate(states) };
  return {
    start: session.start,
    loadMore: session.loadMore,
    retry: session.retry,
    dispose: session.dispose,
    getSnapshot: () => latest,
  };
}
