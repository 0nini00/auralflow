import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { ChevronLeft, Headphones, Music2 } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";

import { CachedImage } from "@/components/CachedImage";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { ErrorState, EmptyState } from "@/components/ScreenState";
import { openPlaylistDetailScreen } from "@/navigation/navigationRef";
import {
  fetchWyPlaylistsByCategory,
  WY_PLAYLIST_CATEGORIES,
} from "@/services/wyLeaderboardService";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";
import { Touchable } from "@/components/Touchable";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";

const PAGE_SIZE = 20;

function formatPlayCount(count?: number): string | null {
  if (!count || count <= 0) return null;
  if (count >= 100_000_000) {
    return `${(count / 100_000_000).toFixed(1)}亿`;
  }
  if (count >= 10_000) {
    return `${Math.round(count / 10_000)}万`;
  }
  return `${count}`;
}

/**
 * 歌单广场（现代双列大图网格 Bento Grid）：
 * - 顶部分类胶囊滑轨（全部/华语/欧美/日语/国风/说唱/摇滚/民谣…）；
 * - 双列正方形大封面卡片 + 右上角播放量半透明角标 + 两行歌单标题；
 * - 触底无限滚动加载与优雅骨架态。
 */
export function PlaylistSquareScreen() {
  const navigation = useNavigation();
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const { width: windowWidth } = useWindowDimensions();

  const [category, setCategory] = useState<string>(WY_PLAYLIST_CATEGORIES[0]);
  const [playlists, setPlaylists] = useState<WyPlaylistInfo[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const flatListRef = useRef<FlatList<WyPlaylistInfo>>(null);
  const pageRef = useRef(0);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

  // 双列卡片宽度自适应计算（屏幕两边 padding 各 16，中间间距 12）
  const cardWidth = Math.floor((windowWidth - spacing.l * 2 - spacing.m) / 2);

  const loadPage = useCallback(
    async (nextCategory: string, reset: boolean) => {
      const requestId = ++requestIdRef.current;
      if (reset) {
        setLoading(true);
        setError(null);
        setLoadMoreError(null);
        pageRef.current = 0;
      } else {
        if (loadingMoreRef.current) return;
        setLoadMoreError(null);
        setLoadingMore(true);
      }
      loadingMoreRef.current = true;
      try {
        const page = await fetchWyPlaylistsByCategory(
          nextCategory,
          "hot",
          PAGE_SIZE,
          reset ? 0 : pageRef.current * PAGE_SIZE,
        );
        if (requestId !== requestIdRef.current) return;
        pageRef.current += 1;
        setHasMore(page.hasMore);
        setPlaylists((prev) => (reset ? page.playlists : [...prev, ...page.playlists]));
      } catch (loadError) {
        if (requestId !== requestIdRef.current) return;
        const message = loadError instanceof Error ? loadError.message : "歌单加载失败";
        if (reset) {
          setError(message);
        } else {
          setLoadMoreError(message);
        }
      } finally {
        loadingMoreRef.current = false;
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadPage(category, true);
  }, [category, loadPage]);

  const handleSelectCategory = (cat: string) => {
    if (cat === category) return;
    hapticLight();
    setCategory(cat);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  const handleRefresh = () => {
    setRefreshing(true);
    void loadPage(category, true);
  };

  const handleEndReached = () => {
    if (loading || loadingMoreRef.current || !hasMore || error || loadMoreError) return;
    void loadPage(category, false);
  };

  const renderCard = ({ item }: { item: WyPlaylistInfo }) => {
    const coverUrl = item.coverImgUrl || item.picUrl;
    const playCountLabel = formatPlayCount(item.playCount);

    return (
      <Touchable
        style={[styles.card, { width: cardWidth }]}
        onPress={() => openPlaylistDetailScreen(item)}
        activeScale={0.97}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}，${playCountLabel ? `播放量 ${playCountLabel}` : ""}`}
      >
        {/* 封面容器（带圆角、播放量微光胶囊） */}
        <View
          style={[
            styles.coverWrap,
            {
              backgroundColor: palette.surfaceStrong,
              borderColor: withAlpha(palette.border, 0.6),
            },
          ]}
        >
          {coverUrl ? (
            <CachedImage
              uri={coverUrl}
              style={styles.coverImage}
              fallback={
                <View style={styles.coverFallback}>
                  <Music2 size={32} color={palette.primary} />
                </View>
              }
            />
          ) : (
            <View style={styles.coverFallback}>
              <Music2 size={32} color={palette.primary} />
            </View>
          )}

          {playCountLabel ? (
            <View style={styles.badgeWrap}>
              <Headphones size={11} color="#ffffff" style={{ marginRight: 3 }} />
              <Text style={styles.badgeText}>{playCountLabel}</Text>
            </View>
          ) : null}
        </View>

        {/* 歌单名称与简介（2行精致标题） */}
        <Text
          numberOfLines={2}
          style={[styles.cardTitle, { color: palette.text }]}
        >
          {item.name}
        </Text>
      </Touchable>
    );
  };

  return (
    <ScreenScaffold>
      <View style={styles.container}>
        {/* 顶部标题栏 */}
        <View style={styles.topHeader}>
          <Touchable
            style={[styles.backBtn, { backgroundColor: palette.surfaceMuted }]}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="返回"
          >
            <ChevronLeft size={22} color={palette.text} />
          </Touchable>
          <View style={styles.headerTitleWrap}>
            <Text style={[styles.pageTitle, { color: palette.text }]}>歌单广场</Text>
            <Text style={[styles.pageSubtitle, { color: palette.textMuted }]}>
              {category} · 热门精选
            </Text>
          </View>
        </View>

        {/* 顶部分类胶囊滑轨 */}
        <View style={styles.categoryScrollWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryContent}
          >
            {WY_PLAYLIST_CATEGORIES.map((item) => {
              const active = item === category;
              return (
                <Touchable
                  key={item}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: active
                        ? palette.primary
                        : palette.surfaceMuted,
                      borderColor: active ? palette.primary : "transparent",
                    },
                  ]}
                  onPress={() => handleSelectCategory(item)}
                  activeScale={0.95}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      {
                        color: active ? palette.primaryText : palette.text,
                        fontWeight: active ? "700" : "500",
                      },
                    ]}
                  >
                    {item}
                  </Text>
                </Touchable>
              );
            })}
          </ScrollView>
        </View>

        {/* 骨架首屏加载状态 */}
        {loading && playlists.length === 0 ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="large" color={palette.primary} />
            <Text style={[styles.loadingHint, { color: palette.textMuted }]}>
              正在探索 {category} 歌单...
            </Text>
          </View>
        ) : null}

        {/* 错误重试状态 */}
        {!loading && error && playlists.length === 0 ? (
          <ErrorState
            message={error}
            onRetry={() => void loadPage(category, true)}
          />
        ) : null}

        {/* 空数据状态 */}
        {!loading && !error && playlists.length === 0 ? (
          <EmptyState title="该分类下暂无歌单" description="试试切换其他分类探索更多音乐" />
        ) : null}

        {/* 双列大图网格列表 */}
        {playlists.length > 0 ? (
          <FlatList
            ref={flatListRef}
            data={playlists}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            renderItem={renderCard}
            numColumns={2}
            columnWrapperStyle={styles.columnWrapper}
            contentContainerStyle={styles.gridContent}
            showsVerticalScrollIndicator={false}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.5}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={palette.primary}
                colors={[palette.primary]}
              />
            }
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator size="small" color={palette.primary} />
                  <Text style={[styles.footerText, { color: palette.textMuted }]}>
                    正在载入更多歌单...
                  </Text>
                </View>
              ) : loadMoreError ? (
                <View style={styles.footerError}>
                  <Text style={[styles.footerErrorText, { color: palette.danger }]}>
                    {loadMoreError}
                  </Text>
                  <Pressable
                    style={styles.retryBtn}
                    onPress={() => void loadPage(category, false)}
                  >
                    <Text style={[styles.retryBtnText, { color: palette.primary }]}>
                      点击重试
                    </Text>
                  </Pressable>
                </View>
              ) : !hasMore ? (
                <Text style={[styles.endText, { color: palette.textSubtle }]}>
                  — 已到达宇宙的尽头 —
                </Text>
              ) : null
            }
          />
        ) : null}
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.l,
    paddingTop: spacing.s,
    paddingBottom: spacing.xs,
    gap: spacing.m,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitleWrap: {
    flex: 1,
    gap: 2,
  },
  pageTitle: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  pageSubtitle: {
    fontSize: typography.caption,
  },
  categoryScrollWrap: {
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  categoryContent: {
    paddingHorizontal: spacing.l,
    gap: spacing.xs,
  },
  categoryChip: {
    paddingHorizontal: spacing.m,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  categoryChipText: {
    fontSize: typography.caption,
  },
  gridContent: {
    paddingHorizontal: spacing.l,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
  },
  columnWrapper: {
    justifyContent: "space-between",
    marginBottom: spacing.l,
  },
  card: {
    gap: spacing.xs,
  },
  coverWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  coverFallback: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  badgeWrap: {
    position: "absolute",
    top: 6,
    right: 6,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "600",
  },
  cardTitle: {
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: "600",
    paddingHorizontal: 2,
  },
  centerLoading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.m,
    paddingVertical: 80,
  },
  loadingHint: {
    fontSize: typography.body,
  },
  footerLoader: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.l,
  },
  footerText: {
    fontSize: typography.caption,
  },
  footerError: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.l,
  },
  footerErrorText: {
    fontSize: typography.caption,
  },
  retryBtn: {
    minHeight: touch.minTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.m,
  },
  retryBtnText: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  endText: {
    textAlign: "center",
    fontSize: typography.caption,
    paddingVertical: spacing.xl,
  },
});
