import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Music2 } from "lucide-react-native";

import { CachedImage } from "@/components/CachedImage";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import { openPlaylistDetailScreen } from "@/navigation/navigationRef";
import {
  boardToPlaylistInfo,
  fetchWyLeaderboardBoards,
  WY_BOARD_GROUPS,
  type WyLeaderboardBoard,
} from "@/services/wyLeaderboardService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";


/**
 * 网易云排行榜页（对齐 lx Leaderboard 视图）：
 * 官方榜 + 语种榜 + 流派榜 + 场景榜 三列网格。
 * 榜单详情复用 PlaylistDetailScreen，无需单独详情页。
 */
export function LeaderboardScreen() {
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const styles = createStyles(palette);

  const [boards, setBoards] = useState<WyLeaderboardBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadBoards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchWyLeaderboardBoards();
      if (mountedRef.current) setBoards(list);
    } catch (loadError) {
      if (mountedRef.current) {
        setError(loadError instanceof Error ? loadError.message : "排行榜加载失败");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // 下拉刷新：保留已加载的榜单网格，不整页切回 LoadingState
  const handleRefresh = useCallback(async () => {
    if (loading || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const list = await fetchWyLeaderboardBoards();
      if (mountedRef.current) setBoards(list);
    } catch (loadError) {
      if (mountedRef.current) {
        setError(loadError instanceof Error ? loadError.message : "排行榜加载失败");
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [loading, refreshing]);

  useEffect(() => {
    mountedRef.current = true;
    void loadBoards();
    return () => {
      mountedRef.current = false;
    };
  }, [loadBoards]);

  const boardById = new Map(boards.map((board) => [board.id, board]));

  const renderBoard = (board: WyLeaderboardBoard) => (
    <Pressable
      key={board.id}
      accessibilityRole="button"
      accessibilityLabel={board.name}
      onPress={() => openPlaylistDetailScreen(boardToPlaylistInfo(board))}
      style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.7 : 1 }]}
    >
      {board.coverUrl ? (
        <CachedImage uri={board.coverUrl} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}>
          <Music2 size={28} color={palette.primary} />
        </View>
      )}
      <Text numberOfLines={1} style={[styles.cellName, { color: palette.text }]}>
        {board.name}
      </Text>
      {board.updateFrequency ? (
        <Text numberOfLines={1} style={[styles.cellMeta, { color: palette.textMuted }]}>
          {board.updateFrequency}
        </Text>
      ) : null}
    </Pressable>
  );

  return (
    <ScreenScaffold>
      <ScreenScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={palette.primary}
            colors={[palette.primary]}
            progressBackgroundColor={palette.surface}
          />
        }
      >
        <Text style={[styles.pageTitle, { color: palette.text }]}>排行榜</Text>

        {loading ? <LoadingState label="正在加载排行榜" /> : null}
        {!loading && error ? (
          <ErrorState message={error} onRetry={() => void loadBoards()} />
        ) : null}

        {!loading && !error
          ? WY_BOARD_GROUPS.map((group) => {
              const groupBoards: WyLeaderboardBoard[] = group.boards.map((item) => {
                const enriched = boardById.get(item.id);
                return enriched ?? { id: item.id, name: item.name, group: group.key };
              });
              return (
                <View key={group.key} style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: palette.text }]}>
                    {group.title}
                  </Text>
                  <View style={styles.grid}>{groupBoards.map(renderBoard)}</View>
                </View>
              );
            })
          : null}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

function createStyles(palette: ReturnType<typeof getThemePalette>) {
  return StyleSheet.create({
    pageTitle: {
      fontSize: typography.heading,
      fontWeight: "700",
      marginBottom: spacing.m,
    },
    section: {
      marginBottom: spacing.l,
      gap: spacing.s,
    },
    sectionTitle: {
      fontSize: typography.title,
      fontWeight: "700",
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.m,
    },
    cell: {
      width: "30%",
      minWidth: 0,
      gap: spacing.xxs,
    },
    cover: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: radius.md,
      backgroundColor: palette.surfaceStrong,
    },
    coverFallback: {
      alignItems: "center",
      justifyContent: "center",
    },
    cellName: {
      fontSize: typography.meta,
      fontWeight: "600",
    },
    cellMeta: {
      fontSize: typography.caption,
    },
  });
}
