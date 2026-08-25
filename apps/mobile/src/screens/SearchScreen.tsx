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
import { SummaryCardGrid } from "@/components/SummaryCardGrid";
import { SearchX, X } from "lucide-react-native";

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
import { LatestRequestGate } from "@/services/latestRequestGate";
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

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { withAlpha } from "@/services/themePaletteModel";
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
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const primarySubtleBackground = withAlpha(palette.primary, palette.statusBar === "dark-content" ? 0.12 : 0.16);
  // 标记当前搜索结果是否来自缓存
  const [fromCache, setFromCache] = useState(false);
  // 竞态保护：快速连续搜索只保留最新一次结果
  const searchRequestSeqRef = React.useRef(0);
  const suggestionRequestGateRef = React.useRef(new LatestRequestGate());
  const setLastSearchKeyword = useSearchQueryStore((s) => s.setLastKeyword);

  const loadHistory = useCallback(async () => {
    try {
      const h = await getSearchHistory();
      setHistory(h);
    } catch (error) {
      console.error("[搜索历史] 加载搜索历史失败", error);
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const requestGate = suggestionRequestGateRef.current;
    const requestId = requestGate.begin();
    const timer = setTimeout(async () => {
      const trimmed = keyword.trim();
      // 已提交搜索的关键词不再弹出建议：点建议/历史会 setKeyword(新词) 触发本防抖，
      // 若不比较 submittedQuery，建议面板会在结果上方“复活”
      if (trimmed.length > 0 && trimmed !== submittedQuery) {
        const sugs = await getSearchSuggestions(trimmed);
        if (!requestGate.isCurrent(requestId)) return;
        setSuggestions(sugs);
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      requestGate.invalidate();
    };
  }, [keyword, submittedQuery]);


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
    [loadHistory, setLastSearchKeyword]
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

  const handleRemoveHistory = async (item: string) => {
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
    [results, dedupedSongs.length]
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

  // 搜索结果页的歌单卡片只负责进入详情（对齐 lx）：收藏/导入功能在歌单详情页内。

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
          placeholderTextColor={palette.textMuted}
          style={[styles.searchInput, { backgroundColor: palette.surface, color: palette.text }]}
          returnKeyType="search"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="搜索"
          style={[styles.searchButton, { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 }]}
          onPress={handleSearch}
        >
          <Text style={[styles.searchButtonText, { color: palette.primary }]}>搜索</Text>
        </Pressable>
        </View>

        {showResults && (
          <View style={styles.tabList}>
            {SEARCH_TABS.map((tab) => (
              <Pressable
                key={tab.key}
                style={[
                  styles.tabButton,
                  { backgroundColor: palette.surface },
                  activeTab === tab.key && { backgroundColor: palette.surfaceStrong, borderColor: palette.primary, borderWidth: 1 },
                ]}
                onPress={() => setActiveTab(tab.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === tab.key }}
              >
                <Text style={[styles.tabText, { color: palette.textMuted }, activeTab === tab.key && { color: palette.text }]}>
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
                  <Text style={[styles.clearHistoryText, { color: palette.textMuted }]}>清空</Text>
                </Pressable>
              )}
              style={styles.historyHeader}
            />
          <View style={styles.historyList}>
            {history.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={`搜索 ${item}`}
                style={[styles.historyItem, { backgroundColor: palette.surface, borderColor: palette.border }]}
                onPress={() => handleHistoryPress(item)}
              >
                <Text style={[styles.historyItemText, { color: palette.text }]}>{item}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除搜索历史 ${item}`}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  style={styles.historyItemDelete}
                  onPress={() => void handleRemoveHistory(item)}
                >
                  <X size={14} color={palette.textMuted} strokeWidth={2.5} />
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
                style={[styles.suggestionItem, { backgroundColor: palette.surface }]}
                onPress={() => handleSuggestionPress(suggestion)}
              >
                <Text style={[styles.suggestionText, { color: palette.text }]}>{suggestion.keyword}</Text>
                <Text style={[styles.suggestionType, { color: palette.textMuted, backgroundColor: palette.surfaceStrong }]}>
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
        <View style={[styles.cacheBadgeBox, { backgroundColor: primarySubtleBackground }]}>
          <Text style={[styles.cacheBadgeText, { color: palette.primary }]}>来自缓存</Text>
        </View>
        )}

        {error && <ErrorState message={error} onRetry={() => void runSearch(submittedQuery)} />}

        {showEmptyResults && (            <EmptyState
              icon={SearchX}
              title="没有找到相关内容"
              description={`没有找到与「${submittedQuery}」匹配的歌曲、歌手、专辑或歌单。`}
            />
        )}

        {showResults && activeTab === "all" && (
          <SummaryCardGrid items={summaryItems} onPress={(key) => setActiveTab(key as SearchTab)} />
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
                    <Text style={[styles.resultSectionAction, { color: palette.primary }]}>查看全部</Text>
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
                    <Text style={[styles.resultSectionAction, { color: palette.primary }]}>查看全部</Text>
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
                    <Text style={[styles.resultSectionAction, { color: palette.primary }]}>查看全部</Text>
                  </Pressable>
                )}
              />
              <PlaylistResultList
                playlists={results.playlists.slice(0, 3)}
                onPress={handlePlaylistPress}
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
                  <Text style={[styles.resultSectionAction, { color: palette.primary }]}>查看全部</Text>
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
        />
        )}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.l,
  },
  section: {
    marginBottom: spacing.m,
  },
  searchBox: {
    flexDirection: "row",
    gap: spacing.s,
    marginBottom: spacing.m,
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
  resultStack: {
    gap: spacing.l,
  },
  resultSection: {
    gap: spacing.s,
  },
  resultSectionAction: {
    fontSize: typography.meta,
  },
  historySection: {
    marginBottom: spacing.l,
  },
  historyHeader: {
    marginBottom: spacing.s,
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
    // 对齐桌面端：多列换行的圆角标签布局，不再一条占一行
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  historyItem: {
    // 桌面端样式移植：圆角胶囊（radius-full）+ 左词右 ×
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingLeft: 12,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  historyItemText: {
    fontSize: typography.body,
    maxWidth: 220,
  },
  historyItemDelete: {
    // 紧凑 X 图标：胶囊内左词右×，命中区由 hitSlop 扩到 44px 触控标准
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionsSection: {
    marginBottom: spacing.l,
  },
  suggestionsHeader: {
    marginBottom: spacing.s,
  },
  suggestionsList: {
    gap: spacing.xs,
  },
  suggestionItem: {
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.s,
    borderRadius: radius.sm,
    gap: spacing.s,
  },
  suggestionText: {
    flex: 1,
    fontSize: typography.body,
  },
  suggestionType: {
    fontSize: typography.caption,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
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
