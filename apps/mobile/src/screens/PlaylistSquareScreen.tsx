import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { PlaylistList } from "@/components/PlaylistList";
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

const PAGE_SIZE = 20;


/**
 * 歌单广场（对齐 lx 桌面端「推荐歌单」）：
 * 横向分类标签（全部/华语/欧美/日语/粤语…）+ 热门排序 + 触底无限滚动。
 * `/api/playlist/list?cat=&order=hot` 已验证可用；catlist 分类接口已下线，分类为内置清单。
 * 「最新」排序会返回新创建的低质歌单且接口不稳定，已按需求移除。
 */
export function PlaylistSquareScreen() {
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const styles = createStyles(palette);

  const [category, setCategory] = useState<string>(WY_PLAYLIST_CATEGORIES[0]);
  const [playlists, setPlaylists] = useState<WyPlaylistInfo[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(0);
  const requestIdRef = useRef(0);
  // 同步守卫：onScroll 单帧多次触发时，避免重复发起「加载更多」请求（state 更新是异步的，防不住同帧连击）。
  const loadingMoreRef = useRef(false);

  const loadPage = useCallback(async (nextCategory: string, reset: boolean) => {
    const requestId = ++requestIdRef.current;
    if (reset) {
      setLoading(true);
      setError(null);
      pageRef.current = 0;
    } else {
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
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
      setPlaylists((previous) => (reset ? page.playlists : [...previous, ...page.playlists]));
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "歌单加载失败");
    } finally {
      loadingMoreRef.current = false;
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadPage(category, true);
  }, [category, loadPage]);

  const handleEndReached = () => {
    if (loading || loadingMoreRef.current || !hasMore || error) return;
    void loadPage(category, false);
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 320) {
      handleEndReached();
    }
  };

  return (
    <ScreenScaffold>
      <View style={styles.root}>
        <Text style={[styles.pageTitle, { color: palette.text }]}>歌单广场</Text>

        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRow}
          >
            {WY_PLAYLIST_CATEGORIES.map((item) => {
              const active = item === category;
              return (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setCategory(item)}
                  style={[
                    styles.chip,
                    { borderColor: active ? palette.primary : palette.border },

                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? palette.primary : palette.textMuted },
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <ScrollView
          onScroll={handleScroll}
          scrollEventThrottle={160}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="small" color={palette.primary} />
              <Text style={[styles.hint, { color: palette.textMuted }]}>正在加载歌单</Text>
            </View>
          ) : null}
          {!loading && error ? (
            <ErrorState
              message={error}
              onRetry={() => void loadPage(category, true)}
            />
          ) : null}
          {!loading && !error && playlists.length === 0 ? (
            <EmptyState title="该分类暂无歌单" />
          ) : null}
          {!loading && !error && playlists.length > 0 ? (
            <PlaylistList
              playlists={playlists}
              onPress={(playlist) => openPlaylistDetailScreen(playlist)}
            />
          ) : null}
          {loadingMore ? (
            <View style={styles.moreBox}>
              <ActivityIndicator size="small" color={palette.primary} />
            </View>
          ) : null}
          {!loading && !loadingMore && !hasMore && playlists.length > 0 ? (
            <Text style={[styles.endText, { color: palette.textMuted }]}>已加载全部</Text>
          ) : null}
        </ScrollView>
      </View>
    </ScreenScaffold>
  );
}

function createStyles(palette: ReturnType<typeof getThemePalette>) {
  return StyleSheet.create({
    root: {
      flex: 1,
      paddingHorizontal: spacing.m,
    },
    pageTitle: {
      fontSize: typography.heading,
      fontWeight: "700",
      marginBottom: spacing.m,
    },
    categoryRow: {
      gap: spacing.xs,
      paddingVertical: spacing.xs,
    },
    chip: {
      paddingHorizontal: spacing.s,
      minHeight: 32,
      borderRadius: radius.pill,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    chipText: {
      fontSize: typography.meta,
      fontWeight: "600",
    },
    listContent: {
      paddingBottom: spacing.l,
    },
    centerBox: {
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.s,
      paddingVertical: 48,
    },
    hint: {
      fontSize: typography.meta,
    },
    moreBox: {
      paddingVertical: spacing.m,
      alignItems: "center",
    },
    endText: {
      textAlign: "center",
      fontSize: typography.caption,
      paddingVertical: spacing.m,
    },
  });
}
