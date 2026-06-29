import type { SearchResult, SearchType } from "@lx/core";

export const SEARCH_ALL_TYPES = ["song", "playlist", "singer", "album"] as const satisfies readonly SearchType[];

export function createEmptySearchResult(): SearchResult {
  return {
    songs: [],
    playlists: [],
    artists: [],
    albums: [],
  };
}

export function mergeSearchResultInto(target: SearchResult, incoming: SearchResult): void {
  target.songs?.push(...(incoming.songs ?? []));
  target.playlists?.push(...(incoming.playlists ?? []));
  target.artists?.push(...(incoming.artists ?? []));
  target.albums?.push(...(incoming.albums ?? []));
}

export function countSearchResults(result: SearchResult): number {
  return (
    (result.songs?.length ?? 0) +
    (result.playlists?.length ?? 0) +
    (result.artists?.length ?? 0) +
    (result.albums?.length ?? 0)
  );
}
