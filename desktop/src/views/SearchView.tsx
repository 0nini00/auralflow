import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Play, Plus, Music2, Bookmark, BookmarkCheck, User, Disc3 } from "lucide-react";
import { registry } from "../services/sources";
import { usePlayerStore } from "../stores/playerStore";
import { useWyAccountStore } from "../stores/wyAccountStore";
import { usePlaylistStore } from "../stores/playlistStore";
import { SongAddMenuButton } from "@/components/SongAddMenuButton";
import { VariantPickerButton } from "@/components/VariantPickerButton";
import { DownloadQualityButton } from "@/components/DownloadQualityButton";
import { formatDuration } from "@/lib/utils";
import { formatPlaylistSearchMeta } from "@/services/neteasePlaylistUtils";
import { RESULT_COVER_CSS_SIZE, coverSrc } from "@/utils/imageReferrerPolicy";
import { buildImportedPlaylistMarker } from "@/utils/shared";
import { buildPlaylistDetailPath } from "@/utils/playlistRoute";
import { createEmptySearchResult } from "@/services/search/searchAggregation";
import { showToast } from "@/components/ui/Toast";
import { createDesktopSearchSession, type DesktopSearchSnapshot } from "@/services/search/pagedSearch";
import { searchResultCache } from "@/services/search/searchResultCache";
import {
  buildSearchSuggestions,
  fetchWySearchSuggestions,
  mergeSearchSuggestions,
  recordSearchKeyword,
  type SearchSuggestion,
} from "@/services/search/searchSuggestions";
import type { MusicSource, PlaylistInfo, AlbumInfo, SearchResult, SearchType } from "@lx/core";
import { groupHasSource, groupSongResults, normalizeSearchKeyword, withSongVariants } from "@lx/core";
import {
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
  replaceSearchHistory,
} from "@/services/search/searchHistory";

type ResultFilter = "overview" | "song" | "artist" | "album" | "playlist";

const SEARCH_RESULT_FILTERS: Array<{ id: ResultFilter; label: string }> = [
  { id: "overview", label: "综合" },
  { id: "song", label: "单曲" },
  { id: "artist", label: "歌手" },
  { id: "album", label: "专辑" },
  { id: "playlist", label: "歌单" },
];

type SongSourceFilter = "all" | "wy" | "tx";

/** 单曲来源筛选：只过滤已聚合的结果列表，不触发重搜（对齐移动端）。 */
const SONG_SOURCE_FILTERS: Array<{ id: SongSourceFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "wy", label: "网易云" },
  { id: "tx", label: "QQ" },
];

function buildSearchKey(keyword: string): string {
  return normalizeSearchKeyword(keyword);
}

function isResultFilter(value: string): value is ResultFilter {
  return SEARCH_RESULT_FILTERS.some((filter) => filter.id === value);
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

interface PagedSearchResult extends SearchResult {
  searchStates: DesktopSearchSnapshot["states"];
}

function toSearchType(filter: ResultFilter): SearchType | undefined {
  if (filter === "overview") return undefined;
  return filter === "artist" ? "singer" : filter;
}

export function SearchView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(initialQuery);
  const [snapshot, setSnapshot] = useState<DesktopSearchSnapshot>({ states: [], result: createEmptySearchResult() });
  const { songs: songResults = [], playlists: playlistResults = [], artists: artistResults = [], albums: albumResults = [] } = snapshot.result;
  const [songSourceFilter, setSongSourceFilter] = useState<SongSourceFilter>("all");
  const [searched, setSearched] = useState(false);
  const [activeResultFilter, setActiveResultFilter] = useState<ResultFilter>("overview");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [onlineSuggestions, setOnlineSuggestions] = useState<SearchSuggestion[]>([]);

  const [actionStatus, setActionStatus] = useState("");

  const [searchHistory, setSearchHistory] = useState<string[]>(getSearchHistory);
  const pageSearchInputRef = useRef<HTMLInputElement | null>(null);

  const playQueue = usePlayerStore((s) => s.playQueue);
  const localPlaylists = usePlaylistStore((s) => s.playlists);
  const importPlaylist = usePlaylistStore((s) => s.importPlaylist);
  const wyAccount = useWyAccountStore((s) => s.account);
  const wyPlaylists = useWyAccountStore((s) => s.playlists);
  const wySetSubscribed = useWyAccountStore((s) => s.setSubscribed);
  const wyCollectedIds = useMemo(() => new Set(wyPlaylists.map((p) => p.id)), [wyPlaylists]);
  const importedPlaylistMarkers = useMemo(
    () =>
      new Set(
        localPlaylists
          .map((playlist) => playlist.description?.match(/\[af-imported-playlist:[^\]]+\]/)?.[0])
          .filter((marker): marker is string => Boolean(marker)),
      ),
    [localPlaylists],
  );
  const [busyPlaylistKey, setBusyPlaylistKey] = useState<string | null>(null);
  const searchSessionRef = useRef<ReturnType<typeof createDesktopSearchSession> | null>(null);
  const lastStartedSearchKeyRef = useRef<string | null>(null);
  const activeResultFilterRef = useRef<ResultFilter>("overview");
  const blurTimerRef = useRef<number | null>(null);
  const suggestRequestSeqRef = useRef(0);

  const handleSearch = useCallback(async (
    term = query,
    options?: { updateUrl?: boolean; preferCache?: boolean },
  ) => {
    const keyword = normalizeSearchKeyword(term);
    if (!keyword) return;
    const searchKey = buildSearchKey(keyword);
    const cached = options?.preferCache ? searchResultCache.get(searchKey) : null;
    const cachedResult = cached?.result as PagedSearchResult | undefined;
    const cachedStates = cachedResult?.searchStates;
    const restoredFilter = cachedStates && cached && isResultFilter(cached.activeFilter)
      ? cached.activeFilter : activeResultFilterRef.current;

    searchSessionRef.current?.dispose();
    lastStartedSearchKeyRef.current = searchKey;
    activeResultFilterRef.current = restoredFilter;
    recordSearchKeyword(keyword);
    addSearchHistory(keyword);
    setSearchHistory(getSearchHistory());
    setSuggestionsOpen(false);
    setQuery(keyword);
    setSearched(true);
    setActiveResultFilter(restoredFilter);
    setSongSourceFilter("all");
    if (options?.updateUrl !== false) setSearchParams({ q: keyword });

    const providers = [registry.get("wy"), registry.get("tx")]
      .filter((provider): provider is MusicSource => Boolean(provider));
    const session = createDesktopSearchSession(keyword, providers, (next) => {
      setSnapshot(next);
      const result: PagedSearchResult = { ...next.result, searchStates: next.states };
      searchResultCache.set(searchKey, { result, activeFilter: activeResultFilterRef.current });
    }, cachedStates);
    searchSessionRef.current = session;
    setSnapshot(session.getSnapshot());
    await session.start();
  }, [query, setSearchParams]);

  useEffect(() => {
    const trimmed = normalizeSearchKeyword(initialQuery);
    if (!trimmed) return;

    const searchKey = buildSearchKey(trimmed);
    if (lastStartedSearchKeyRef.current === searchKey) return;
    handleSearch(trimmed, { updateUrl: false, preferCache: true }).catch(() => undefined);
  }, [handleSearch, initialQuery]);

  useEffect(() => {
    return () => {
      searchSessionRef.current?.dispose();
      searchSessionRef.current = null;
      lastStartedSearchKeyRef.current = null;
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
        .catch(() => {
          if (requestId === suggestRequestSeqRef.current) {
            setOnlineSuggestions([]);
          }
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleSearch().catch(() => undefined);
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

  /** 结果行统一键盘激活：Enter / Space 触发该行已有的 onClick。 */
  const resultRowKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.currentTarget.click();
  };

  function handleSearchInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      event.currentTarget.blur();
    }
  }

  function handleSuggestionClick(value: string) {
    handleSearch(value).catch(() => undefined);
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
        const created = importPlaylist(playlist.name, description || marker, songs, playlist.picUrl);
        setActionStatus(`已收藏到本地歌单：${created.name}`);
      }
    } catch (err) {
      setActionStatus(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyPlaylistKey(null);
    }
  };

  const songGroups = useMemo(() => groupSongResults(songResults), [songResults]);
  const songSourceCounts = useMemo(
    () => ({
      wy: songGroups.filter((group) => groupHasSource(group, "wy")).length,
      tx: songGroups.filter((group) => groupHasSource(group, "tx")).length,
    }),
    [songGroups],
  );
  const filteredSongGroups = useMemo(
    () =>
      songSourceFilter === "all"
        ? songGroups
        : songGroups.filter((group) => groupHasSource(group, songSourceFilter)),
    [songGroups, songSourceFilter],
  );
  const playableSongQueue = useMemo(
    () => filteredSongGroups.map((group) => withSongVariants(group.primary, group.variants)),
    [filteredSongGroups],
  );
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
  const activeSearchType = toSearchType(activeResultFilter);
  const selectedStates = snapshot.states.filter((state) => !activeSearchType || state.source.category === activeSearchType);
  const loading = selectedStates.some((state) => state.status === "loading" || state.status === "idle");
  const categoryErrors = selectedStates.flatMap((state) => state.error ? [state.error] : []);
  const categoryFailed = selectedStates.length > 0 && selectedStates.every((state) => state.page === 0 && state.status === "error");
  const retrySearch = () => { void searchSessionRef.current?.retry(activeSearchType); };
  const moreType = activeSearchType ?? "song";
  const moreLabel = activeResultFilter === "overview" ? "单曲" : activeResultFilterLabel;
  const moreStates = snapshot.states.filter((state) => state.source.category === moreType);
  const moreLoading = moreStates.some((state) => state.status === "loading");
  const canLoadMore = moreStates.some((state) => state.status === "ready" && state.hasMore);
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
            ref={pageSearchInputRef}
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



      {!searched && searchHistory.length > 0 && (

        <div className="af-search-history">

          <div className="af-search-history-header">

            <span>搜索历史</span>

            <button

              type="button"

              className="af-search-history-clear"

              onClick={() => {
                const previous = getSearchHistory();
                if (previous.length === 0) return;
                clearSearchHistory();
                setSearchHistory([]);
                showToast("已清空搜索历史", {
                  actionLabel: "撤销",
                  onAction: () => {
                    replaceSearchHistory(previous);
                    setSearchHistory(previous);
                  },
                });
              }}

            >

              清空

            </button>

          </div>

          <div className="af-search-history-list">

            {searchHistory.map((item) => (

              <div key={item} className="af-search-history-item">

                <button

                  type="button"

                  className="af-search-history-text"

                  onClick={() => handleSearch(item)}

                >

                  {item}

                </button>

                <button

                  type="button"

                  className="af-search-history-delete"

                  onClick={(e) => {

                    e.stopPropagation();

                    removeSearchHistory(item);

                    setSearchHistory(getSearchHistory());

                  }}

                  aria-label={`删除 ${item}`}

                >

                  ×

                </button>

              </div>

            ))}

          </div>

        </div>

      )}



      {!searched && searchHistory.length === 0 && (
        <div className="af-search-idle">
          <div className="af-search-idle-mark" aria-hidden="true">
            <Music2 size={22} strokeWidth={1.7} />
          </div>
          <h2>搜点什么</h2>
          <p>输入歌名、歌手或专辑；也可以直接粘贴歌单链接。</p>
          <p className="af-search-idle-kbd">
            顶栏搜索随时可用 · <kbd>Ctrl</kbd> + <kbd>K</kbd>
          </p>
        </div>
      )}

      {actionStatus && <div className="af-search-action-status">{actionStatus}</div>}



      {loading && visibleResultCount === 0 && (
        <div className="af-skeleton-list" aria-busy="true" aria-label="加载中">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="af-skeleton-row" />
          ))}
        </div>
      )}

      {categoryErrors.length > 0 && (
        <div className="af-page-feedback" role="status">
          <strong>{categoryFailed ? `${activeResultFilterLabel}搜索失败` : "部分搜索结果加载失败"}</strong>
          <span>{categoryErrors.join("；")}</span>
          <button type="button" className="af-btn-secondary" onClick={retrySearch}>重试</button>
        </div>
      )}

      {!loading && searched && categoryErrors.length === 0 && visibleResultCount === 0 && (
        <div className="af-empty-state">
          <p>{activeResultFilter === "overview" ? "没有找到相关内容" : `没有找到${activeResultFilterLabel}`}</p>
          <span>可以换个关键词试试</span>
          <button
            type="button"
            className="af-btn-primary"
            onClick={() => {
              pageSearchInputRef.current?.focus();
              pageSearchInputRef.current?.select();
            }}
          >
            修改关键词
          </button>
        </div>
      )}

      {showOverview && hasOverviewHighlights && (
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
                  {overviewArtist.picUrl ? <img src={coverSrc(overviewArtist.picUrl, RESULT_COVER_CSS_SIZE)} alt="" /> : <div className="af-cover-placeholder" />}
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
                  {overviewAlbum.picUrl ? <img src={coverSrc(overviewAlbum.picUrl, RESULT_COVER_CSS_SIZE)} alt="" /> : <div className="af-cover-placeholder" />}
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
                // 未登录网易云时隐藏「收藏到网易云账号」按钮；tx 等来源是收藏到本地歌单，与登录无关
                const canCollect = overviewPlaylist.source !== "wy" || !!wyAccount;
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
                      {overviewPlaylist.picUrl ? <img src={coverSrc(overviewPlaylist.picUrl, RESULT_COVER_CSS_SIZE)} alt="" /> : <div className="af-cover-placeholder" />}
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
                      {canCollect && (
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
                      )}
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

      {showArtistResults && artistResults.length > 0 && (
        <section className="af-search-section">
          <h2 className="af-search-section-title">歌手</h2>
          <ul className="af-search-results">
            {artistResults.map((artist) => (
            <li
              key={`${artist.source}:${artist.id}`}
              className="af-search-result-item"
              role="button"
              tabIndex={0}
              onKeyDown={resultRowKeyDown}
              onClick={() => {
                if (artist.source === "wy") navigate(`/artist/${artist.id}`);
              }}
              title={artist.source === "wy" ? "打开歌手详情" : "暂不支持打开歌手详情"}
            >
              <span className="af-result-index"><User size={16} /></span>
              <div className="af-result-cover">
                {artist.picUrl ? <img src={coverSrc(artist.picUrl, RESULT_COVER_CSS_SIZE)} alt="" /> : <div className="af-cover-placeholder" />}
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

      {showAlbumResults && albumResults.length > 0 && (
        <section className="af-search-section">
          <h2 className="af-search-section-title">专辑</h2>
          <ul className="af-search-results">
            {albumResults.map((album) => (
              <li
                key={`${album.source}:${album.id}`}
                className="af-search-result-item"
                role="button"
                tabIndex={0}
                onKeyDown={resultRowKeyDown}
                onClick={() => {
                  if (album.source === "wy") navigate(buildAlbumDetailPath(album));
                }}
                title={album.source === "wy" ? "打开专辑详情" : "暂不支持打开专辑详情"}
              >
                <span className="af-result-index"><Disc3 size={16} /></span>
                <div className="af-result-cover">
                  {album.picUrl ? <img src={coverSrc(album.picUrl, RESULT_COVER_CSS_SIZE)} alt="" /> : <div className="af-cover-placeholder" />}
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

      {showPlaylistResults && playlistResults.length > 0 && (
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
                // 未登录网易云时隐藏「收藏到网易云账号」按钮；tx 等来源是收藏到本地歌单，与登录无关
                const canCollect = playlist.source !== "wy" || !!wyAccount;
                return (
                  <li
                    key={playlistKey}
                    className="af-search-result-item"
                    role="button"
                    tabIndex={0}
                    onKeyDown={resultRowKeyDown}
                    onClick={() => {
                      navigate(buildPlaylistDetailPath(playlist), { state: { playlist } });
                    }}
                    title="打开歌单"
                  >
                    <span className="af-result-index"><Music2 size={16} /></span>
                    <div className="af-result-cover">
                      {playlist.picUrl ? <img src={coverSrc(playlist.picUrl, RESULT_COVER_CSS_SIZE)} alt="" /> : <div className="af-cover-placeholder" />}
                    </div>
                    <div className="af-result-info">
                      <div className="af-result-title" title={playlist.name}>{playlist.name}</div>
                      <div className="af-result-subtitle" title={playlist.author}>{playlist.author || "未知创建者"}</div>
                    </div>
                    <div className="af-result-duration af-result-playlist-meta">{formatPlaylistSearchMeta(playlist)}</div>
                    <div className="af-result-actions" onClick={(e) => e.stopPropagation()}>
                      {canCollect && (
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
                      )}
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

      {showSongResults && songGroups.length > 0 && (
        <section className="af-search-section">
          <div className="af-search-section-head">
            <h2 className="af-search-section-title">单曲</h2>
            <div className="af-source-filter" role="group" aria-label="按来源筛选单曲">
              {SONG_SOURCE_FILTERS.map((filter) => {
                // 无该来源匹配时置灰：点进去只会看到空列表，不如提前说明
                const disabled = filter.id !== "all" && songSourceCounts[filter.id] === 0;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    className={`af-source-filter-chip${songSourceFilter === filter.id ? " is-active" : ""}`}
                    onClick={() => setSongSourceFilter(filter.id)}
                    disabled={disabled}
                    aria-pressed={songSourceFilter === filter.id}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </div>
          <ul className="af-search-results">
            {filteredSongGroups.map((group, index) => {
            const music = playableSongQueue[index];
            return (
              <li
                key={group.key}
                className="af-search-result-item"
                role="button"
                tabIndex={0}
                onKeyDown={resultRowKeyDown}
                onClick={() => playQueue(playableSongQueue, index)}
                title="单击播放"
              >
                <span className="af-result-index">{index + 1}</span>
                <div className="af-result-cover">
                  {music.img || music.picUrl ? (
                    <img src={coverSrc(music.img || music.picUrl, RESULT_COVER_CSS_SIZE)} alt="" />
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
                  <VariantPickerButton
                    song={music}
                    iconSize={16}
                    title="其他版本"
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
      {(canLoadMore || (moreLoading && visibleResultCount > 0)) && (
        <div className="af-search-section">
          <button
            type="button"
            className="af-btn-secondary"
            disabled={moreLoading}
            onClick={() => { void searchSessionRef.current?.loadMore(moreType); }}
          >
            {moreLoading ? `正在加载${moreLabel}` : `加载更多${moreLabel}`}
          </button>
        </div>
      )}
    </div>
  );
}
