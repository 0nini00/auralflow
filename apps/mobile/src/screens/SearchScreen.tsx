import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
} from "react-native";
import type { MusicInfo } from "@lx/core";
import { layout, radius, spacing, touch, typography } from "@/theme/tokens";

import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SongList } from "@/components/SongList";
import { groupSongResults, type SongGroup } from "@/services/songGroupModel";
import {
  AlbumResultList,
  ArtistResultList,
  PlaylistResultList,
} from "@/components/SearchResultSections";
import {
  searchAll,
  type SearchAlbumResult,
  type SearchArtistResult,
  type SearchPlaylistResult,
  type SearchResults,
} from "@/services/musicApi";
import { hasCachedResult } from "@/services/searchResultCache";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { getSearchSuggestions, type SearchSuggestion } from "@/services/searchSuggestionService";
import {
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
} from "@/services/searchHistoryService";
import {
  openAlbumDetailScreen,
  openArtistDetailScreen,
  openPlaylistDetailScreen,
  openSearchFallbackDetailScreen,
} from "@/navigation";
import {
  openSearchAlbumDetail,
  openSearchArtistDetail,
  openSearchPlaylistDetail,
  type SearchDetailRoute,
} from "@/services/searchDetailNavigation";
import {
  buildAlbumFallbackDetail,
  buildArtistFallbackDetail,
} from "@/services/searchFallbackDetailModel";
import { usePlaylistStore } from "@/stores/playlistStore";
import { useAccountStore } from "@/stores/accountStore";
import { getPlaylistDetail } from "@/services/wyPlaylistService";
import { getTxPlaylistDetail, mapTxPlaylistInfo } from "@/services/txPlaylistService";
import {
  buildImportedSearchPlaylist,
  getSearchPlaylistPrimaryAction,
} from "@/services/searchPlaylistImportModel";
import { buildScreenTheme } from "@/services/screenThemeModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { useSearchQueryStore } from "@/stores/searchQueryStore";

interface SearchScreenProps {
  onNavigateToPlayer: () => void;
  initialKeyword?: string | null;
  onInitialKeywordConsumed?: () => void;
  /**
   * 深链直达搜索详情:auralflow://searchDetail/... 会解析为一个 route,
   * 在 Search 屏挂载后立即派发到 Artist/Album/Playlist 详情屏。
   */
  initialDetailRoute?: SearchDetailRoute | null;
  onInitialDetailRouteConsumed?: () => void;
}

type SearchTab = "all" | "songs" | "artists" | "albums" | "playlists";

const SEARCH_TABS: Array<{ key: SearchTab; label: string }> = [
  { key: "all", label: "综合" },
  { key: "songs", label: "单曲" },
  { key: "artists", label: "歌手" },
  { key: "albums", label: "专辑" },
  { key: "playlists", label: "歌单" },
];

const EMPTY_RESULTS: SearchResults = {
  songs: [],
  artists: [],
  albums: [],
  playlists: [],
};


export function SearchScreen({
  onNavigateToPlayer,
  initialKeyword = null,
  onInitialKeywordConsumed,
  initialDetailRoute = null,
  onInitialDetailRouteConsumed,
}: SearchScreenProps) {
  const [keyword, setKeyword] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [activeTab, setActiveTab] = useState<SearchTab>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [importingPlaylistKey, setImportingPlaylistKey] = useState<string | null>(null);
  const user = useAccountStore((state) => state.user);
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const localPlaylists = usePlaylistStore((state) => state.localPlaylists);
  const wyPlaylists = usePlaylistStore((state) => state.playlists);
  const createLocalPlaylistWithSongs = usePlaylistStore((state) => state.createLocalPlaylistWithSongs);
  const setWyPlaylistSubscribed = usePlaylistStore((state) => state.setWyPlaylistSubscribed);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const screenTheme = buildScreenTheme(palette);
  // 标记当前搜索结果是否来自缓存
  const [fromCache, setFromCache] = useState(false);
  // 竞态保护：快速连续搜索只保留最新一次结果
  const searchRequestSeqRef = React.useRef(0);
  const setLastSearchKeyword = useSearchQueryStore((s) => s.setLastKeyword);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const h = await getSearchHistory();
    setHistory(h);
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (keyword.trim().length > 0) {
        const sugs = await getSearchSuggestions(keyword.trim());
        setSuggestions(sugs);
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [keyword]);


  const runSearch = useCallback(
    async (rawKeyword: string) => {
      const query = rawKeyword.trim();
      if (!query) return;
      setLastSearchKeyword(query);
      setSubmittedQuery(query);

      const requestId = ++searchRequestSeqRef.current;

      setShowSuggestions(false);
      setLoading(true);
      setError(null);
      setActiveTab("all");
      setFromCache(hasCachedResult("all", query, "all"));

      try {
        const nextResults = await searchAll("all", query);
        if (requestId !== searchRequestSeqRef.current) return;
        setResults(nextResults);
        await addSearchHistory(query);
        await loadHistory();
      } catch (err) {
        if (requestId !== searchRequestSeqRef.current) return;
        setResults(EMPTY_RESULTS);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestId === searchRequestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!initialKeyword?.trim()) return;
    setKeyword(initialKeyword);
    void runSearch(initialKeyword);
    onInitialKeywordConsumed?.();
  }, [initialKeyword, onInitialKeywordConsumed, runSearch]);

  // 深链直达搜索详情:进 Search 屏后立即派发到对应 Artist/Album/Playlist 详情
  useEffect(() => {
    if (!initialDetailRoute) return;
    switch (initialDetailRoute.type) {
      case "artist":
        openArtistDetailScreen(initialDetailRoute.artist);
        break;
      case "album":
        openAlbumDetailScreen(initialDetailRoute.album, initialDetailRoute.parentArtist);
        break;
      case "playlist":
        openPlaylistDetailScreen(initialDetailRoute.playlist);
        break;
    }
    onInitialDetailRouteConsumed?.();
  }, [initialDetailRoute, onInitialDetailRouteConsumed]);

  const handleSearch = useCallback(async () => {
    await runSearch(keyword);
  }, [keyword, runSearch]);

  // 跨源去重：同名同歌手歌曲合并为一行
  const songGroups = useMemo(() => groupSongResults(results.songs), [results.songs]);
  const dedupedSongs = useMemo(() => songGroups.map((g) => g.primary), [songGroups]);

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
    onNavigateToPlayer();
  };

  const handlePlay = async (_song: MusicInfo, index: number) => {
    await runPlayback(() => playQueue(dedupedSongs, index));
  };

  /** 去重后显示多源标记，如 "wy / tx" */
  const getSongSourceLabel = (song: MusicInfo): string | undefined => {
    const group = songGroups.find((g) => g.primary === song || (g.primary.source === song.source && g.primary.id === song.id));
    if (!group || group.variants.length <= 1) return undefined;
    const sources = [...new Set(group.variants.map((v) => v.source.toUpperCase()))];
    return sources.join(" / ");
  };

  const handleSuggestionPress = (suggestion: SearchSuggestion) => {
    setKeyword(suggestion.keyword);
    setShowSuggestions(false);
    void runSearch(suggestion.keyword);
  };

  const handleHistoryPress = (item: string) => {
    setKeyword(item);
    setShowSuggestions(false);
    void runSearch(item);
  };

  const handleRemoveHistory = async (item: string, e: any) => {
    e.stopPropagation();
    await removeSearchHistory(item);
    await loadHistory();
  };

  const handleClearHistory = async () => {
    await clearSearchHistory();
    await loadHistory();
  };

  const summaryItems = useMemo(
    () => [
      { key: "songs", label: "单曲", count: dedupedSongs.length },
      { key: "artists", label: "歌手", count: results.artists.length },
      { key: "albums", label: "专辑", count: results.albums.length },
      { key: "playlists", label: "歌单", count: results.playlists.length },
    ],
    [results]
  );

  const hasResults =
    results.songs.length > 0 ||
    results.artists.length > 0 ||
    results.albums.length > 0 ||
    results.playlists.length > 0;
  const showResults = Boolean(submittedQuery) && !loading && !error && hasResults;
  const showEmptyResults = Boolean(submittedQuery) && !loading && !error && !hasResults;



  const handleArtistPress = (artist: SearchArtistResult) => {
    const route = openSearchArtistDetail(artist);
    if (route) {
      openArtistDetailScreen(route.artist);
      return;
    }
    // 非网易云：降级为当前搜索结果里的相关歌曲列表，避免“点了没反应”
    openSearchFallbackDetailScreen(buildArtistFallbackDetail(artist, results.songs));
  };

  const handleAlbumPress = (album: SearchAlbumResult) => {
    const route = openSearchAlbumDetail(album, null);
    if (route) {
      openAlbumDetailScreen(route.album, route.parentArtist);
      return;
    }
    openSearchFallbackDetailScreen(buildAlbumFallbackDetail(album, results.songs));
  };

  const handlePlaylistPress = (playlist: SearchPlaylistResult) => {
    const route = openSearchPlaylistDetail(playlist);
    if (route) openPlaylistDetailScreen(route.playlist);
  };


  const handleImportPlaylist = async (playlist: SearchPlaylistResult) => {
    const key = `${playlist.source}:${playlist.id}`;
    if (importingPlaylistKey) return;
    setImportingPlaylistKey(key);
    try {
      if (playlist.source === "wy") {
        if (!isLoggedIn || !user) {
          Alert.alert("需要登录", "请先登录网易云账号");
          return;
        }

        await setWyPlaylistSubscribed(user.userId, playlist, true);
        Alert.alert("收藏成功", `已收藏「${playlist.name}」到网易云`);
        return;
      }

      const songs = playlist.source === "tx"
        ? await getTxPlaylistDetail(mapTxPlaylistInfo(playlist))
        : await getPlaylistDetail(playlist.id);
      const importedPlaylist = buildImportedSearchPlaylist(playlist, songs);
      await createLocalPlaylistWithSongs(importedPlaylist);
      Alert.alert("导入成功", `已导入「${playlist.name}」到本地歌单`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("导入失败", message);
    } finally {
      setImportingPlaylistKey(null);
    }
  };

  const getPlaylistImportAction = (playlist: SearchPlaylistResult) => {
    const action = getSearchPlaylistPrimaryAction(playlist, wyPlaylists, localPlaylists);
    const key = `${playlist.source}:${playlist.id}`;
    return {
      label: action.label,
      disabled: action.disabled,
      loading: importingPlaylistKey === key,
      onPress: handleImportPlaylist,
    };
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <SectionHeader title="搜索音乐" style={styles.section} />
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />

        <View style={styles.searchBox}>
        <TextInput
          accessibilityLabel="搜索关键词"
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={handleSearch}
          placeholder="搜索歌曲、歌手、专辑…"
          placeholderTextColor={screenTheme.bodyText}
          style={[styles.searchInput, { backgroundColor: screenTheme.cardBackground, color: screenTheme.titleText }]}
          returnKeyType="search"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="搜索"
          style={[styles.searchButton, { backgroundColor: screenTheme.primaryBackground }]}
          onPress={handleSearch}
        >
          <Text style={[styles.searchButtonText, { color: screenTheme.primaryText }]}>搜索</Text>
        </Pressable>
        </View>

        {showResults && (
          <View style={styles.tabList}>
            {SEARCH_TABS.map((tab) => (
              <Pressable
                key={tab.key}
                style={[
                  styles.tabButton,
                  { backgroundColor: screenTheme.cardBackground },
                  activeTab === tab.key && { backgroundColor: screenTheme.strongBackground, borderColor: screenTheme.primaryBackground, borderWidth: 1 },
                ]}
                onPress={() => setActiveTab(tab.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === tab.key }}
              >
                <Text style={[styles.tabText, { color: screenTheme.bodyText }, activeTab === tab.key && { color: screenTheme.titleText }]}>
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {!keyword && history.length > 0 && (
          <View style={styles.historySection}>
            <SectionHeader
              title="搜索历史"
              action={(
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="清空搜索历史"
                  style={styles.headerAction}
                  onPress={handleClearHistory}
                >
                  <Text style={[styles.clearHistoryText, { color: screenTheme.bodyText }]}>清空</Text>
                </Pressable>
              )}
              style={styles.historyHeader}
            />
          <View style={styles.historyList}>
            {history.map((item, index) => (
              <Pressable
                key={index}
                accessibilityRole="button"
                accessibilityLabel={`搜索 ${item}`}
                style={[styles.historyItem, { backgroundColor: screenTheme.cardBackground }]}
                onPress={() => handleHistoryPress(item)}
              >
                <Text style={[styles.historyItemText, { color: screenTheme.titleText }]}>{item}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除搜索历史 ${item}`}
                  style={styles.historyItemDelete}
                  onPress={(e) => handleRemoveHistory(item, e)}
                >
                  <Text style={[styles.historyItemDeleteText, { color: screenTheme.bodyText }]}>删除</Text>
                </Pressable>
              </Pressable>
            ))}
          </View>
          </View>
        )}

        {showSuggestions && suggestions.length > 0 && (
          <View style={styles.suggestionsSection}>
            <SectionHeader title="搜索建议" style={styles.suggestionsHeader} />
          <View style={styles.suggestionsList}>
            {suggestions.map((suggestion, index) => (
              <Pressable
                key={index}
                accessibilityRole="button"
                accessibilityLabel={`搜索建议 ${suggestion.keyword}`}
                style={[styles.suggestionItem, { backgroundColor: screenTheme.cardBackground }]}
                onPress={() => handleSuggestionPress(suggestion)}
              >
                <Text style={[styles.suggestionText, { color: screenTheme.titleText }]}>{suggestion.keyword}</Text>
                <Text style={[styles.suggestionType, { color: screenTheme.bodyText, backgroundColor: screenTheme.strongBackground }]}>
                  {suggestion.type === "song"
                    ? "单曲"
                    : suggestion.type === "artist"
                      ? "歌手"
                      : suggestion.type === "album"
                        ? "专辑"
                        : suggestion.type === "playlist"
                          ? "歌单"
                          : ""}
                </Text>
              </Pressable>
            ))}
          </View>
          </View>
        )}

        {loading && <LoadingState label="正在搜索" />}

        {fromCache && !loading && !error && hasResults && (
        <View style={[styles.cacheBadgeBox, { backgroundColor: screenTheme.primarySubtleBackground }]}>
          <Text style={[styles.cacheBadgeText, { color: screenTheme.primaryBackground }]}>来自缓存</Text>
        </View>
        )}

        {error && <ErrorState message={error} onRetry={() => void runSearch(submittedQuery)} />}

        {showEmptyResults && (
          <EmptyState
            title="没有找到相关内容"
            description={`没有找到与「${submittedQuery}」匹配的歌曲、歌手、专辑或歌单。`}
          />
        )}

        {showResults && activeTab === "all" && (
        <View style={styles.summaryGrid}>
          {summaryItems.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`查看${item.label}结果，共 ${item.count} 项`}
              style={[styles.summaryCard, { backgroundColor: screenTheme.cardBackground }]}
              onPress={() => setActiveTab(item.key as SearchTab)}
            >
              <Text style={[styles.summaryValue, { color: screenTheme.titleText }]}>{item.count}</Text>
              <Text style={[styles.summaryLabel, { color: screenTheme.bodyText }]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        )}

        {showResults && activeTab === "all" && (
        <View style={styles.resultStack}>
          {results.artists.length > 0 && (
            <View style={styles.resultSection}>
              <SectionHeader
                title="歌手"
                action={(
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="查看全部歌手"
                    style={styles.headerAction}
                    onPress={() => setActiveTab("artists")}
                  >
                    <Text style={[styles.resultSectionAction, { color: screenTheme.primaryBackground }]}>查看全部</Text>
                  </Pressable>
                )}
              />
              <ArtistResultList artists={results.artists.slice(0, 3)} onPress={handleArtistPress} />
            </View>
          )}

          {results.albums.length > 0 && (
            <View style={styles.resultSection}>
              <SectionHeader
                title="专辑"
                action={(
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="查看全部专辑"
                    style={styles.headerAction}
                    onPress={() => setActiveTab("albums")}
                  >
                    <Text style={[styles.resultSectionAction, { color: screenTheme.primaryBackground }]}>查看全部</Text>
                  </Pressable>
                )}
              />
              <AlbumResultList albums={results.albums.slice(0, 3)} onPress={handleAlbumPress} />
            </View>
          )}

          {results.playlists.length > 0 && (
            <View style={styles.resultSection}>
              <SectionHeader
                title="歌单"
                action={(
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="查看全部歌单"
                    style={styles.headerAction}
                    onPress={() => setActiveTab("playlists")}
                  >
                    <Text style={[styles.resultSectionAction, { color: screenTheme.primaryBackground }]}>查看全部</Text>
                  </Pressable>
                )}
              />
              <PlaylistResultList
                playlists={results.playlists.slice(0, 3)}
                onPress={handlePlaylistPress}
                getImportAction={getPlaylistImportAction}
              />
            </View>
          )}

          <View style={styles.resultSection}>
            <SectionHeader
              title="单曲"
              action={results.songs.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="查看全部单曲"
                  style={styles.headerAction}
                  onPress={() => setActiveTab("songs")}
                >
                  <Text style={[styles.resultSectionAction, { color: screenTheme.primaryBackground }]}>查看全部</Text>
                </Pressable>
              ) : undefined}
            />
            <SongList songs={dedupedSongs} onPlay={handlePlay} getExtraMetadata={getSongSourceLabel} emptyText="没有找到单曲" />
          </View>
        </View>
        )}

        {showResults && activeTab === "songs" && (
        <SongList songs={dedupedSongs} onPlay={handlePlay} getExtraMetadata={getSongSourceLabel} emptyText="没有找到单曲" />
        )}

        {showResults && activeTab === "artists" && (
          <ArtistResultList artists={results.artists} emptyText="没有找到歌手" onPress={handleArtistPress} />
        )}

        {showResults && activeTab === "albums" && (
          <AlbumResultList albums={results.albums} emptyText="没有找到专辑" onPress={handleAlbumPress} />
        )}

        {showResults && activeTab === "playlists" && (
        <PlaylistResultList
          playlists={results.playlists}
          emptyText="没有找到歌单"
          onPress={handlePlaylistPress}
          getImportAction={getPlaylistImportAction}
        />
        )}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  section: {
    marginBottom: 16,
  },
  searchBox: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    minHeight: touch.minTarget,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.sm,
    fontSize: typography.body,
  },
  searchButton: {
    minHeight: touch.minTarget,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radius.sm,
    justifyContent: "center",
  },
  searchButtonText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  tabList: {
    width: "100%",
    flexDirection: "row",
    gap: spacing.xxs,
  },
  tabButton: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.compactControlHeight,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xxs,
    alignItems: "center",
    justifyContent: "center",
  },
  tabText: {
    fontSize: typography.meta,
    fontWeight: "500",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  summaryCard: {
    width: "48%",
    borderRadius: radius.sm,
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 4,
  },
  summaryValue: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  summaryLabel: {
    fontSize: typography.caption,
  },
  resultStack: {
    gap: 20,
  },
  resultSection: {
    gap: 10,
  },
  resultSectionAction: {
    fontSize: typography.meta,
  },
  historySection: {
    marginBottom: 20,
  },
  historyHeader: {
    marginBottom: 12,
  },
  headerAction: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  clearHistoryText: {
    fontSize: typography.meta,
  },
  historyList: {
    gap: 8,
  },
  historyItem: {
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: radius.sm,
  },
  historyItemText: {
    flex: 1,
    fontSize: typography.body,
  },
  historyItemDelete: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  historyItemDeleteText: {
    fontSize: typography.meta,
  },
  suggestionsSection: {
    marginBottom: 20,
  },
  suggestionsHeader: {
    marginBottom: 12,
  },
  suggestionsList: {
    gap: 8,
  },
  suggestionItem: {
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: radius.sm,
    gap: 12,
  },
  suggestionText: {
    flex: 1,
    fontSize: typography.body,
  },
  suggestionType: {
    fontSize: typography.caption,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cacheBadgeBox: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.md,
    marginBottom: 12,
  },
  cacheBadgeText: {
    fontSize: typography.caption,
  },
});
