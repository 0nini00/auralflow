import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Play, Plus, Music2, Bookmark, BookmarkCheck, User, Disc3 } from "lucide-react";
import { registry } from "../services/sources";
import { usePlayerStore } from "../stores/playerStore";
import { useWyAccountStore } from "../stores/wyAccountStore";
import { usePlaylistStore } from "../stores/playlistStore";
import { SongAddMenuButton } from "@/components/SongAddMenuButton";
import { DownloadQualityButton } from "@/components/DownloadQualityButton";
import { formatDuration } from "@/lib/utils";
import { logAsyncError } from "@/utils/logAsyncError";
import { formatPlaylistSearchMeta } from "@/services/neteasePlaylistUtils";
import {
  countSearchResults,
  createEmptySearchResult,
  mergeSearchResultInto,
  SEARCH_ALL_TYPES,
} from "@/services/search/searchAggregation";
import { searchResultCache } from "@/services/search/searchResultCache";
import {
  buildSearchSuggestions,
  fetchWySearchSuggestions,
  mergeSearchSuggestions,
  recordSearchKeyword,
  type SearchSuggestion,
} from "@/services/search/searchSuggestions";
import type { MusicInfo, PlaylistInfo, ArtistInfo, AlbumInfo, SearchResult, SearchType } from "@lx/core";

interface CombinedSongResult {
  key: string;
  primary: MusicInfo;
  variants: MusicInfo[];
}

type ResultFilter = "overview" | "song" | "artist" | "album" | "playlist";

const SEARCH_RESULT_FILTERS: Array<{ id: ResultFilter; label: string }> = [
  { id: "overview", label: "综合" },
  { id: "song", label: "单曲" },
  { id: "artist", label: "歌手" },
  { id: "album", label: "专辑" },
  { id: "playlist", label: "歌单" },
];

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, "")
    .replace(/[\s\-—_·.,，。:：'"《》<>]/g, "")
    .trim();
}

function splitSingerTokens(singer: string): string[] {
  return singer
    .split(/[、/,，&＋+]/)
    .map(normalizeText)
    .filter(Boolean);
}

function hasSingerOverlap(a: MusicInfo, b: MusicInfo): boolean {
  const singersA = splitSingerTokens(a.singer);
  const singersB = splitSingerTokens(b.singer);
  if (singersA.length === 0 || singersB.length === 0) return false;
  return singersA.some((singerA) => singersB.some((singerB) => singerA === singerB));
}

function isSameSong(a: MusicInfo, b: MusicInfo): boolean {
  if (normalizeText(a.name) !== normalizeText(b.name)) return false;
  if (!hasSingerOverlap(a, b)) return false;

  if (a.interval && b.interval) {
    return Math.abs(a.interval - b.interval) <= 6;
  }

  return true;
}

function sourceRank(source: MusicInfo["source"]): number {
  if (source === "wy") return 0;
  if (source === "tx") return 1;
  return 2;
}

function groupSongResults(songs: MusicInfo[]): CombinedSongResult[] {
  const groups: CombinedSongResult[] = [];

  for (const song of songs) {
    const existing = groups.find((group) => group.variants.some((variant) => isSameSong(variant, song)));
    if (!existing) {
      groups.push({
        key: `${normalizeText(song.name)}:${normalizeText(song.singer)}:${song.interval ?? 0}`,
        primary: song,
        variants: [song],
      });
      continue;
    }

    if (!existing.variants.some((variant) => variant.source === song.source && variant.id === song.id)) {
      existing.variants.push(song);
    }

    existing.variants.sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
    existing.primary = existing.variants[0];
  }

  return groups;
}

function buildSearchKey(keyword: string): string {
  return keyword;
}

function isResultFilter(value: string): value is ResultFilter {
  return SEARCH_RESULT_FILTERS.some((filter) => filter.id === value);
}

function buildPlaylistDetailPath(playlist: PlaylistInfo): string {
  return `/playlist/${encodeURIComponent(playlist.id)}?source=${playlist.source}`;
}

function buildAlbumDetailPath(album: AlbumInfo): string {
  return `/album/${encodeURIComponent(album.id)}`;
}

function getFeaturedAlbum(albums: AlbumInfo[]): AlbumInfo | null {
  if (albums.length === 0) return null;
  return [...albums].sort((a, b) => (b.publishTime ?? 0) - (a.publishTime ?? 0))[0];
}

function getFeaturedPlaylist(playlists: PlaylistInfo[]): PlaylistInfo | null {
  if (playlists.length === 0) return null;
  return [...playlists].sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))[0];
}

function buildImportedPlaylistMarker(playlist: PlaylistInfo): string {
  return `[af-imported-playlist:${playlist.source}:${playlist.id}]`;
}

async function searchAllSources(
  keyword: string,
  type: SearchType,
): Promise<SearchResult> {
  const providers = [registry.get("wy"), registry.get("tx")]
    .filter((provider) => provider?.supportedSearchTypes.includes(type));
  const settled = await Promise.allSettled(
    providers.map((provider) => provider!.search(keyword, type, 1)),
  );
  const result: SearchResult = { songs: [], playlists: [], artists: [], albums: [] };
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const item of settled) {
    if (item.status === "rejected") {
      errors.push(item.reason instanceof Error ? item.reason.message : String(item.reason));
      continue;
    }

    for (const song of item.value.songs ?? []) {
      const key = `song:${song.source}:${song.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.songs!.push(song);
    }

    for (const playlist of item.value.playlists ?? []) {
      const key = `pl:${playlist.source}:${playlist.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.playlists!.push(playlist);
    }

    for (const artist of item.value.artists ?? []) {
      const key = `ar:${artist.source}:${artist.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.artists!.push(artist);
    }

    for (const album of item.value.albums ?? []) {
      const key = `al:${album.source}:${album.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.albums!.push(album);
    }
  }

  const totalCount =
    (result.songs?.length ?? 0) +
    (result.playlists?.length ?? 0) +
    (result.artists?.length ?? 0) +
    (result.albums?.length ?? 0);

  if (totalCount === 0 && errors.length > 0) {
    throw new Error(errors.join("；"));
  }

  return result;
}

async function searchMergedSources(keyword: string): Promise<SearchResult> {
  const result = createEmptySearchResult();
  const errors: string[] = [];
  const settled = await Promise.allSettled(
    SEARCH_ALL_TYPES.map((type) => searchAllSources(keyword, type)),
  );

  for (const item of settled) {
    if (item.status === "rejected") {
      errors.push(item.reason instanceof Error ? item.reason.message : String(item.reason));
      continue;
    }
    mergeSearchResultInto(result, item.value);
  }

  if (countSearchResults(result) === 0 && errors.length > 0) {
    throw new Error(errors.join("；"));
  }

  return result;
}

export function SearchView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(initialQuery);
  const [songResults, setSongResults] = useState<MusicInfo[]>([]);
  const [playlistResults, setPlaylistResults] = useState<PlaylistInfo[]>([]);
  const [artistResults, setArtistResults] = useState<ArtistInfo[]>([]);
  const [albumResults, setAlbumResults] = useState<AlbumInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeResultFilter, setActiveResultFilter] = useState<ResultFilter>("overview");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [onlineSuggestions, setOnlineSuggestions] = useState<SearchSuggestion[]>([]);
  const [searchError, setSearchError] = useState("");
  const [actionStatus, setActionStatus] = useState("");

  const playQueue = usePlayerStore((s) => s.playQueue);
  const localPlaylists = usePlaylistStore((s) => s.playlists);
  const importPlaylist = usePlaylistStore((s) => s.importPlaylist);
  const updatePlaylistCover = usePlaylistStore((s) => s.updatePlaylistCover);
  const wyAccount = useWyAccountStore((s) => s.account);
  const wyLoad = useWyAccountStore((s) => s.load);
  const wyPlaylists = useWyAccountStore((s) => s.playlists);
  const wySetSubscribed = useWyAccountStore((s) => s.setSubscribed);
  const wyCollectedIds = new Set(wyPlaylists.map((p) => p.id));
  const importedPlaylistMarkers = new Set(
    localPlaylists
      .map((playlist) => playlist.description?.match(/\[af-imported-playlist:[^\]]+\]/)?.[0])
      .filter((marker): marker is string => Boolean(marker)),
  );
  const [busyPlaylistKey, setBusyPlaylistKey] = useState<string | null>(null);
  const searchRequestSeqRef = useRef(0);
  const lastStartedSearchKeyRef = useRef<string | null>(null);
  const activeResultFilterRef = useRef<ResultFilter>("overview");
  const blurTimerRef = useRef<number | null>(null);
  const suggestRequestSeqRef = useRef(0);

  const applySearchResult = useCallback((res: SearchResult) => {
    setSongResults(res.songs ?? []);
    setPlaylistResults(res.playlists ?? []);
    setArtistResults(res.artists ?? []);
    setAlbumResults(res.albums ?? []);
  }, []);

  const handleSearch = useCallback(async (
    term = query,
    options?: { updateUrl?: boolean; preferCache?: boolean },
  ) => {
    const trimmed = term.trim();
    if (!trimmed) return;

    const searchKey = buildSearchKey(trimmed);

    if (options?.preferCache) {
      const cached = searchResultCache.get(searchKey);
      if (cached) {
        const restoredFilter = isResultFilter(cached.activeFilter) ? cached.activeFilter : "overview";
        searchRequestSeqRef.current += 1;
        lastStartedSearchKeyRef.current = searchKey;
        activeResultFilterRef.current = restoredFilter;
        recordSearchKeyword(trimmed);
        setQuery(trimmed);
        if (options?.updateUrl !== false) {
          setSearchParams({ q: trimmed });
        }
        setLoading(false);
        setSearched(true);
        setSearchError("");
        setActiveResultFilter(restoredFilter);
        applySearchResult(cached.result);
        return;
      }
    }

    const requestId = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = requestId;
    lastStartedSearchKeyRef.current = searchKey;
    recordSearchKeyword(trimmed);
    setSuggestionsOpen(false);
    setQuery(trimmed);
    if (options?.updateUrl !== false) {
      setSearchParams({ q: trimmed });
    }
    setLoading(true);
    setSearched(true);
    setSearchError("");
    setSongResults([]);
    setPlaylistResults([]);
    setArtistResults([]);
    setAlbumResults([]);

    try {
      const res = await searchMergedSources(trimmed);
      if (requestId !== searchRequestSeqRef.current) return;
      searchResultCache.set(searchKey, {
        result: res,
        activeFilter: activeResultFilterRef.current,
      });
      applySearchResult(res);
    } catch (error) {
      if (requestId !== searchRequestSeqRef.current) return;
      setSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === searchRequestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [applySearchResult, query, setSearchParams]);

  useEffect(() => {
    const trimmed = initialQuery.trim();
    if (!trimmed) return;

    const searchKey = buildSearchKey(trimmed);
    if (lastStartedSearchKeyRef.current === searchKey) return;
    handleSearch(trimmed, { updateUrl: false, preferCache: true }).catch(logAsyncError("search:url-query"));
  }, [handleSearch, initialQuery]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const requestId = suggestRequestSeqRef.current + 1;
    suggestRequestSeqRef.current = requestId;

    if (trimmed.length < 2) {
      setOnlineSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      fetchWySearchSuggestions(trimmed)
        .then((items) => {
          if (requestId === suggestRequestSeqRef.current) {
            setOnlineSuggestions(items);
          }
        })
        .catch((error) => {
          if (requestId === suggestRequestSeqRef.current) {
            setOnlineSuggestions([]);
          }
          logAsyncError("search:suggest:view")(error);
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleSearch().catch(logAsyncError("search:submit"));
  }

  function handleSearchInputChange(value: string) {
    setQuery(value);
    setSuggestionsOpen(true);
  }

  function handleSearchInputFocus() {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setSuggestionsOpen(true);
  }

  function handleSearchInputBlur() {
    blurTimerRef.current = window.setTimeout(() => setSuggestionsOpen(false), 120);
  }

  function handleSearchInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      event.currentTarget.blur();
    }
  }

  function handleSuggestionClick(value: string) {
    handleSearch(value).catch(logAsyncError("search:suggestion"));
  }

  function handleResultFilterChange(filter: ResultFilter) {
    activeResultFilterRef.current = filter;
    setActiveResultFilter(filter);

    const searchKey = buildSearchKey(query.trim());
    if (searchKey) {
      searchResultCache.updateFilter(searchKey, filter);
    }
  }

  const handleCollectPlaylist = async (playlist: PlaylistInfo) => {
    const key = `${playlist.source}:${playlist.id}`;
    setBusyPlaylistKey(key);
    setActionStatus("");
    try {
      if (playlist.source === "wy") {
        if (!wyAccount) {
          await wyLoad();
        }
        await wySetSubscribed(playlist.id, true);
        setActionStatus("已收藏到网易云账号");
        return;
      }

      if (playlist.source === "tx") {
        const marker = buildImportedPlaylistMarker(playlist);
        const existing = localPlaylists.find((item) => item.description?.includes(marker));
        if (existing) {
          setActionStatus(`本地歌单已存在：${existing.name}`);
          return;
        }

        const provider = registry.get("tx");
        if (!provider) throw new Error("未找到 QQ 音乐源");
        const songs = await provider.getPlaylistDetail(playlist);
        const description = [playlist.desc, marker].filter(Boolean).join("\n");
        const created = importPlaylist(playlist.name, description || marker, songs);
        if (playlist.picUrl) {
          updatePlaylistCover(created.id, playlist.picUrl);
        }
        setActionStatus(`已收藏到本地歌单：${created.name}`);
      }
    } catch (err) {
      setActionStatus(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyPlaylistKey(null);
    }
  };

  const songGroups = groupSongResults(songResults);
  const playableSongQueue = songGroups.map((group) => ({
    ...group.primary,
    variants: group.variants,
  } as MusicInfo & { variants: MusicInfo[] }));
  const resultCount = songGroups.length + playlistResults.length + artistResults.length + albumResults.length;
  const resultFilterCounts: Record<ResultFilter, number> = {
    overview: resultCount,
    song: songGroups.length,
    artist: artistResults.length,
    album: albumResults.length,
    playlist: playlistResults.length,
  };
  const localSearchSuggestions = useMemo(() => buildSearchSuggestions(query, {
    songs: songResults,
    playlists: playlistResults,
    artists: artistResults,
    albums: albumResults,
  }), [albumResults, artistResults, playlistResults, query, songResults]);
  const searchSuggestions = useMemo(
    () => mergeSearchSuggestions(onlineSuggestions, localSearchSuggestions),
    [localSearchSuggestions, onlineSuggestions],
  );
  const canShowSuggestions = suggestionsOpen && query.trim().length > 0 && searchSuggestions.length > 0;
  const activeResultFilterLabel =
    SEARCH_RESULT_FILTERS.find((filter) => filter.id === activeResultFilter)?.label ?? "相关内容";
  const visibleResultCount = resultFilterCounts[activeResultFilter];
  const showOverview = activeResultFilter === "overview";
  const showArtistResults = activeResultFilter === "artist";
  const showAlbumResults = activeResultFilter === "album";
  const showPlaylistResults = activeResultFilter === "playlist";
  const showSongResults = showOverview || activeResultFilter === "song";
  const overviewArtist = artistResults[0] ?? null;
  const overviewAlbum = getFeaturedAlbum(albumResults);
  const overviewPlaylist = getFeaturedPlaylist(playlistResults);
  const hasOverviewHighlights = Boolean(overviewArtist || overviewAlbum || overviewPlaylist);

  return (
    <div className="af-search-view af-animate-slide-in">
      <form className="af-search-hero" onSubmit={handleSubmit} role="search">
        <label htmlFor="search-input" className="af-sr-only">
          搜索
        </label>
        <div className="af-search-input-wrap">
          <input
            id="search-input"
            type="search"
            value={query}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            onFocus={handleSearchInputFocus}
            onBlur={handleSearchInputBlur}
            onKeyDown={handleSearchInputKeyDown}
            placeholder="搜索歌曲、歌手、专辑…"
            className="af-search-input"
            autoComplete="off"
          />
          {canShowSuggestions && (
            <div className="af-search-suggestions" role="listbox" aria-label="搜索联想">
              {searchSuggestions.map((suggestion) => (
                <button
                  key={`${suggestion.type}:${suggestion.value}`}
                  type="button"
                  className="af-search-suggestion-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSuggestionClick(suggestion.value)}
                >
                  <span>{suggestion.label}</span>
                  <small>{suggestion.meta}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="submit" className="af-search-submit">
          搜索
        </button>
      </form>

      <div className="af-search-tabs" role="tablist" aria-label="搜索分类">
        {SEARCH_RESULT_FILTERS.map((filter) => {
          const isActive = activeResultFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? "af-tab-active" : ""}
              onClick={() => handleResultFilterChange(filter.id)}
            >
              <span>{filter.label}</span>
            </button>
          );
        })}
      </div>

      {actionStatus && <div className="af-search-action-status">{actionStatus}</div>}

      {loading && (
        <div className="af-skeleton-list" aria-busy="true" aria-label="加载中">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="af-skeleton-row" />
          ))}
        </div>
      )}

      {!loading && searchError && (
        <div className="af-empty-state">
          <p>搜索失败</p>
          <span>{searchError}</span>
        </div>
      )}

      {!loading && searched && !searchError && visibleResultCount === 0 && (
        <div className="af-empty-state">
          <p>{activeResultFilter === "overview" ? "没有找到相关内容" : `没有找到${activeResultFilterLabel}`}</p>
          <span>可以换个关键词试试</span>
        </div>
      )}

      {!loading && !searchError && showOverview && hasOverviewHighlights && (
        <section className="af-search-section af-search-overview">
          <h2 className="af-search-section-title">综合</h2>
          <div className="af-search-overview-list">
            {overviewArtist && (
              <button
                type="button"
                className="af-search-overview-item"
                onClick={() => {
                  if (overviewArtist.source === "wy") navigate(`/artist/${overviewArtist.id}`);
                }}
                disabled={overviewArtist.source !== "wy"}
              >
                <span className="af-result-index"><User size={16} /></span>
                <div className="af-result-cover">
                  {overviewArtist.picUrl ? <img src={overviewArtist.picUrl} alt="" /> : <div className="af-cover-placeholder" />}
                </div>
                <div className="af-result-info">
                  <div className="af-result-kicker">歌手</div>
                  <div className="af-result-title" title={overviewArtist.name}>{overviewArtist.name}</div>
                  <div className="af-result-subtitle">
                    {overviewArtist.musicSize ? `${overviewArtist.musicSize} 首作品` : "相关歌手"}
                    {overviewArtist.albumSize ? ` · ${overviewArtist.albumSize} 张专辑` : ""}
                  </div>
                </div>
                <span className="af-search-open-text">{overviewArtist.source === "wy" ? "打开" : "暂不支持详情"}</span>
              </button>
            )}

            {overviewAlbum && (
              <button
                type="button"
                className="af-search-overview-item"
                onClick={() => {
                  if (overviewAlbum.source === "wy") navigate(buildAlbumDetailPath(overviewAlbum));
                }}
                disabled={overviewAlbum.source !== "wy"}
              >
                <span className="af-result-index"><Disc3 size={16} /></span>
                <div className="af-result-cover">
                  {overviewAlbum.picUrl ? <img src={overviewAlbum.picUrl} alt="" /> : <div className="af-cover-placeholder" />}
                </div>
                <div className="af-result-info">
                  <div className="af-result-kicker">新专辑</div>
                  <div className="af-result-title" title={overviewAlbum.name}>{overviewAlbum.name}</div>
                  <div className="af-result-subtitle" title={overviewAlbum.artist}>
                    {overviewAlbum.artist || "未知歌手"}
                    {overviewAlbum.trackCount ? ` · ${overviewAlbum.trackCount} 首` : ""}
                  </div>
                </div>
                <span className="af-search-open-text">{overviewAlbum.source === "wy" ? "打开" : "暂不支持详情"}</span>
              </button>
            )}

            {overviewPlaylist && (
              (() => {
                const playlistKey = `${overviewPlaylist.source}:${overviewPlaylist.id}`;
                const playlistMeta = formatPlaylistSearchMeta(overviewPlaylist);
                const importedMarker = buildImportedPlaylistMarker(overviewPlaylist);
                const isCollected = overviewPlaylist.source === "wy"
                  ? wyCollectedIds.has(overviewPlaylist.id)
                  : importedPlaylistMarkers.has(importedMarker);
                const collectTitle = isCollected
                  ? "已收藏"
                  : overviewPlaylist.source === "wy"
                    ? "收藏到网易云账号"
                    : "收藏到本地歌单";
                return (
                  <div
                    key={playlistKey}
                    className="af-search-overview-item"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      navigate(buildPlaylistDetailPath(overviewPlaylist), { state: { playlist: overviewPlaylist } });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(buildPlaylistDetailPath(overviewPlaylist), { state: { playlist: overviewPlaylist } });
                      }
                    }}
                    title="打开歌单"
                  >
                    <span className="af-result-index"><Music2 size={16} /></span>
                    <div className="af-result-cover">
                      {overviewPlaylist.picUrl ? <img src={overviewPlaylist.picUrl} alt="" /> : <div className="af-cover-placeholder" />}
                    </div>
                    <div className="af-result-info">
                      <div className="af-result-kicker">歌单</div>
                      <div className="af-result-title" title={overviewPlaylist.name}>{overviewPlaylist.name}</div>
                      <div className="af-result-subtitle" title={overviewPlaylist.author}>
                        {overviewPlaylist.author || "未知创建者"}
                        {playlistMeta ? ` · ${playlistMeta}` : ""}
                      </div>
                    </div>
                    <div className="af-result-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="af-action-btn"
                        onClick={() => { void handleCollectPlaylist(overviewPlaylist); }}
                        disabled={busyPlaylistKey === playlistKey || isCollected}
                        title={collectTitle}
                        aria-label={collectTitle}
                      >
                        {isCollected
                          ? <BookmarkCheck size={16} />
                          : <Bookmark size={16} />}
                      </button>
                      <span
                        className="af-search-open-text"
                        onClick={() => navigate(buildPlaylistDetailPath(overviewPlaylist), { state: { playlist: overviewPlaylist } })}
                      >打开</span>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </section>
      )}

      {!loading && !searchError && showArtistResults && artistResults.length > 0 && (
        <section className="af-search-section">
          <h2 className="af-search-section-title">歌手</h2>
          <ul className="af-search-results">
            {artistResults.map((artist) => (
            <li
              key={`${artist.source}:${artist.id}`}
              className="af-search-result-item"
              onClick={() => {
                if (artist.source === "wy") navigate(`/artist/${artist.id}`);
              }}
              title={artist.source === "wy" ? "打开歌手详情" : "暂不支持打开歌手详情"}
            >
              <span className="af-result-index"><User size={16} /></span>
              <div className="af-result-cover">
                {artist.picUrl ? <img src={artist.picUrl} alt="" /> : <div className="af-cover-placeholder" />}
              </div>
              <div className="af-result-info">
                <div className="af-result-title" title={artist.name}>{artist.name}</div>
                <div className="af-result-subtitle">
                  {artist.musicSize ? `${artist.musicSize} 首作品` : ""}
                  {artist.albumSize ? ` · ${artist.albumSize} 张专辑` : ""}
                </div>
              </div>
              <div className="af-result-duration"></div>
              <div className="af-result-actions" onClick={(e) => e.stopPropagation()}>
                {artist.source === "wy" ? (
                  <span
                    className="af-search-open-text"
                    onClick={() => navigate(`/artist/${artist.id}`)}
                    style={{ cursor: "pointer" }}
                  >打开</span>
                ) : (
                  <span className="af-search-open-text">暂不支持详情</span>
                )}
              </div>
            </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && !searchError && showAlbumResults && albumResults.length > 0 && (
        <section className="af-search-section">
          <h2 className="af-search-section-title">专辑</h2>
          <ul className="af-search-results">
            {albumResults.map((album) => (
              <li
                key={`${album.source}:${album.id}`}
                className="af-search-result-item"
                onClick={() => {
                  if (album.source === "wy") navigate(buildAlbumDetailPath(album));
                }}
                title={album.source === "wy" ? "打开专辑详情" : "暂不支持打开专辑详情"}
              >
                <span className="af-result-index"><Disc3 size={16} /></span>
                <div className="af-result-cover">
                  {album.picUrl ? <img src={album.picUrl} alt="" /> : <div className="af-cover-placeholder" />}
                </div>
                <div className="af-result-info">
                  <div className="af-result-title" title={album.name}>{album.name}</div>
                  <div className="af-result-subtitle" title={album.artist}>
                    {album.artist || "未知歌手"}
                    {album.trackCount ? ` · ${album.trackCount} 首` : ""}
                  </div>
                </div>
                <div className="af-result-duration"></div>
                <div className="af-result-actions" onClick={(e) => e.stopPropagation()}>
                  {album.source === "wy" ? (
                    <span
                      className="af-search-open-text"
                      onClick={() => navigate(buildAlbumDetailPath(album))}
                      style={{ cursor: "pointer" }}
                    >打开</span>
                  ) : (
                    <span className="af-search-open-text">暂不支持详情</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && !searchError && showPlaylistResults && playlistResults.length > 0 && (
        <section className="af-search-section">
          <h2 className="af-search-section-title">歌单</h2>
          <ul className="af-search-results">
            {playlistResults.map((playlist) => (
              (() => {
                const playlistKey = `${playlist.source}:${playlist.id}`;
                const importedMarker = buildImportedPlaylistMarker(playlist);
                const isCollected = playlist.source === "wy"
                  ? wyCollectedIds.has(playlist.id)
                  : importedPlaylistMarkers.has(importedMarker);
                const collectTitle = isCollected
                  ? "已收藏"
                  : playlist.source === "wy"
                    ? "收藏到网易云账号"
                    : "收藏到本地歌单";
                return (
                  <li
                    key={playlistKey}
                    className="af-search-result-item"
                    onClick={() => {
                      navigate(buildPlaylistDetailPath(playlist), { state: { playlist } });
                    }}
                    title="打开歌单"
                  >
                    <span className="af-result-index"><Music2 size={16} /></span>
                    <div className="af-result-cover">
                      {playlist.picUrl ? <img src={playlist.picUrl} alt="" /> : <div className="af-cover-placeholder" />}
                    </div>
                    <div className="af-result-info">
                      <div className="af-result-title" title={playlist.name}>{playlist.name}</div>
                      <div className="af-result-subtitle" title={playlist.author}>{playlist.author || "未知创建者"}</div>
                    </div>
                    <div className="af-result-duration af-result-playlist-meta">{formatPlaylistSearchMeta(playlist)}</div>
                    <div className="af-result-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="af-action-btn"
                        onClick={() => { void handleCollectPlaylist(playlist); }}
                        disabled={busyPlaylistKey === playlistKey || isCollected}
                        title={collectTitle}
                        aria-label={collectTitle}
                      >
                        {isCollected
                          ? <BookmarkCheck size={16} />
                          : <Bookmark size={16} />}
                      </button>
                      <span
                        className="af-search-open-text"
                        onClick={() => navigate(buildPlaylistDetailPath(playlist), { state: { playlist } })}
                      >打开</span>
                    </div>
                  </li>
                );
              })()
            ))}
          </ul>
        </section>
      )}

      {!loading && !searchError && showSongResults && songGroups.length > 0 && (
        <section className="af-search-section">
          <h2 className="af-search-section-title">单曲</h2>
          <ul className="af-search-results">
            {songGroups.map((group, index) => {
            const music = playableSongQueue[index];
            return (
              <li
                key={group.key}
                className="af-search-result-item"
                onClick={() => playQueue(playableSongQueue, index)}
                title="单击播放"
              >
                <span className="af-result-index">{index + 1}</span>
                <div className="af-result-cover">
                  {music.img || music.picUrl ? (
                    <img src={music.img || music.picUrl} alt="" />
                  ) : (
                    <div className="af-cover-placeholder" />
                  )}
                </div>
                <div className="af-result-info">
                  <div className="af-result-title" title={music.name}>{music.name}</div>
                  <div className="af-result-subtitle" title={music.singer}>{music.singer}</div>
                </div>
                <div className="af-result-duration">{formatDuration(music.interval ?? 0)}</div>
                <div className="af-result-actions">
                  <button
                    className="af-action-btn"
                    onClick={(e) => { e.stopPropagation(); playQueue(playableSongQueue, index); }}
                    title="播放"
                  >
                    <Play size={16} />
                  </button>
                  <button
                    className="af-action-btn"
                    onClick={(e) => { e.stopPropagation(); usePlayerStore.getState().addToQueue(music); }}
                    title="加入播放队列"
                  >
                    <Plus size={16} />
                  </button>
                  <SongAddMenuButton
                    song={music}
                    iconSize={16}
                    title="添加到我的喜欢或歌单"
                  />
                  <DownloadQualityButton
                    song={music}
                    iconSize={16}
                    title="下载"
                  />
                </div>
              </li>
            );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
