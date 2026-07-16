import type { AlbumInfo, ArtistInfo, MusicInfo, PlaylistInfo } from "@lx/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const RECENT_SEARCH_KEY = "af_recent_search_keywords";
const MAX_RECENT_KEYWORDS = 10;
const MAX_SUGGESTIONS = 8;

export type SearchSuggestionType = "recent" | "song" | "artist" | "album" | "playlist";

export interface SearchSuggestion {
  value: string;
  label: string;
  meta: string;
  type: SearchSuggestionType;
}

export interface SearchSuggestionSources {
  songs?: MusicInfo[];
  playlists?: PlaylistInfo[];
  artists?: ArtistInfo[];
  albums?: AlbumInfo[];
}

function normalizeKeyword(keyword: string): string {
  return keyword.normalize("NFKC").trim().toLowerCase();
}

function getStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function getStoredSearchKeywords(): string[] {
  const storage = getStorage();
  if (!storage) return [];

  const raw = storage.getItem(RECENT_SEARCH_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    storage.removeItem(RECENT_SEARCH_KEY);
    return [];
  }
}

export function recordSearchKeyword(keyword: string): void {
  const trimmed = keyword.trim();
  const storage = getStorage();
  if (!trimmed || !storage) return;

  const normalized = normalizeKeyword(trimmed);
  const next = [
    trimmed,
    ...getStoredSearchKeywords().filter((item) => normalizeKeyword(item) !== normalized),
  ].slice(0, MAX_RECENT_KEYWORDS);
  storage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
}

function appendSuggestion(
  suggestions: SearchSuggestion[],
  seen: Set<string>,
  query: string,
  suggestion: SearchSuggestion,
): void {
  if (suggestions.length >= MAX_SUGGESTIONS) return;
  if (!normalizeKeyword(suggestion.value).includes(query)) return;

  const key = normalizeKeyword(suggestion.value);
  if (seen.has(key)) return;
  seen.add(key);
  suggestions.push(suggestion);
}

function appendOnlineSuggestion(
  suggestions: SearchSuggestion[],
  seen: Set<string>,
  suggestion: SearchSuggestion,
): void {
  if (suggestions.length >= MAX_SUGGESTIONS) return;
  if (!suggestion.value.trim()) return;

  const key = normalizeKeyword(suggestion.value);
  if (seen.has(key)) return;
  seen.add(key);
  suggestions.push(suggestion);
}

async function fetchJson(url: string): Promise<any> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Referer: "https://music.163.com/",
  };
  let browserError: unknown = null;

  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    try {
      const response = await window.fetch(url, { headers });
      if (!response.ok) throw new Error(`browser HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      browserError = error;
    }
  }

  try {
    const response = await tauriFetch(url, { headers });
    if (!response.ok) throw new Error(`tauri HTTP ${response.status}`);
    return response.json();
  } catch (tauriError) {
    const first = browserError instanceof Error ? browserError.message : String(browserError);
    const second = tauriError instanceof Error ? tauriError.message : String(tauriError);
    throw new Error(`网易云联想请求失败：browser=${first}; tauri=${second}`);
  }
}

export async function fetchWySearchSuggestions(input: string): Promise<SearchSuggestion[]> {
  const keyword = input.trim();
  if (!keyword) return [];

  const url = `https://music.163.com/api/search/suggest/web?s=${encodeURIComponent(keyword)}`;
  const body = await fetchJson(url);
  const result = body?.result ?? {};
  const suggestions: SearchSuggestion[] = [];
  const seen = new Set<string>();

  for (const artist of (result.artists ?? []) as any[]) {
    appendOnlineSuggestion(suggestions, seen, {
      value: String(artist.name ?? ""),
      label: String(artist.name ?? ""),
      meta: "歌手",
      type: "artist",
    });
  }

  for (const album of (result.albums ?? []) as any[]) {
    appendOnlineSuggestion(suggestions, seen, {
      value: String(album.name ?? ""),
      label: String(album.name ?? ""),
      meta: album.artist?.name ? `专辑 · ${album.artist.name}` : "专辑",
      type: "album",
    });
  }

  for (const playlist of (result.playlists ?? []) as any[]) {
    appendOnlineSuggestion(suggestions, seen, {
      value: String(playlist.name ?? ""),
      label: String(playlist.name ?? ""),
      meta: playlist.creator?.nickname ? `歌单 · ${playlist.creator.nickname}` : "歌单",
      type: "playlist",
    });
  }

  for (const song of (result.songs ?? []) as any[]) {
    const artists = Array.isArray(song.artists)
      ? song.artists.map((artist: any) => artist?.name).filter(Boolean).join(" / ")
      : "";
    appendOnlineSuggestion(suggestions, seen, {
      value: String(song.name ?? ""),
      label: String(song.name ?? ""),
      meta: artists ? `单曲 · ${artists}` : "单曲",
      type: "song",
    });
  }

  return suggestions;
}

export function mergeSearchSuggestions(...lists: SearchSuggestion[][]): SearchSuggestion[] {
  const suggestions: SearchSuggestion[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const suggestion of list) {
      appendOnlineSuggestion(suggestions, seen, suggestion);
    }
  }

  return suggestions;
}

export function buildSearchSuggestions(
  input: string,
  sources: SearchSuggestionSources = {},
): SearchSuggestion[] {
  const query = normalizeKeyword(input);
  if (!query) return [];

  const suggestions: SearchSuggestion[] = [];
  const seen = new Set<string>();

  for (const keyword of getStoredSearchKeywords()) {
    appendSuggestion(suggestions, seen, query, {
      value: keyword,
      label: keyword,
      meta: "最近搜索",
      type: "recent",
    });
  }

  for (const artist of sources.artists ?? []) {
    appendSuggestion(suggestions, seen, query, {
      value: artist.name,
      label: artist.name,
      meta: "歌手",
      type: "artist",
    });
  }

  for (const album of sources.albums ?? []) {
    appendSuggestion(suggestions, seen, query, {
      value: album.name,
      label: album.name,
      meta: album.artist ? `专辑 · ${album.artist}` : "专辑",
      type: "album",
    });
  }

  for (const playlist of sources.playlists ?? []) {
    appendSuggestion(suggestions, seen, query, {
      value: playlist.name,
      label: playlist.name,
      meta: playlist.author ? `歌单 · ${playlist.author}` : "歌单",
      type: "playlist",
    });
  }

  for (const song of sources.songs ?? []) {
    appendSuggestion(suggestions, seen, query, {
      value: song.name,
      label: song.name,
      meta: song.singer ? `单曲 · ${song.singer}` : "单曲",
      type: "song",
    });
    appendSuggestion(suggestions, seen, query, {
      value: song.singer,
      label: song.singer,
      meta: "歌手",
      type: "artist",
    });
  }

  return suggestions;
}
