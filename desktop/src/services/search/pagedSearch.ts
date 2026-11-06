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

function mergeUnique(current: SearchResult, incoming: SearchResult): SearchResult {
  const next = createEmptySearchResult();
  const seen = new Set<string>();
  const add = (items: readonly { id: string; source: string }[] | undefined, key: string, target: unknown[]) => {
    for (const item of items ?? []) {
      const id = `${key}:${item.source}:${item.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      target.push(item);
    }
  };
  add(current.songs, "song", next.songs!);
  add(current.playlists, "playlist", next.playlists!);
  add(current.artists, "artist", next.artists!);
  add(current.albums, "album", next.albums!);
  add(incoming.songs, "song", next.songs!);
  add(incoming.playlists, "playlist", next.playlists!);
  add(incoming.artists, "artist", next.artists!);
  add(incoming.albums, "album", next.albums!);
  return next;
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
      const result = states.reduce((acc, state) => mergeUnique(acc, state.result), createEmptySearchResult());
      latest = { states, result };
      onChange?.(latest);
    },
  });
  const states = session.getSnapshot();
  latest = { states, result: states.reduce((acc, state) => mergeUnique(acc, state.result), createEmptySearchResult()) };
  return {
    start: session.start,
    loadMore: session.loadMore,
    retry: session.retry,
    dispose: session.dispose,
    getSnapshot: () => latest,
  };
}
