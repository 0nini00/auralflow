import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChevronRight, Music2, Trophy } from "lucide-react-native";

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
import { Touchable } from "@/components/Touchable";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";

/**
 * 网易云排行榜页：
 * - 官方榜（前 4 大榜）：横向通栏大卡片（左侧封面 + 右侧 TOP 3 歌曲试读）；
 * - 语种榜 / 流派榜 / 场景榜：下方精致 3 列网格，主次分明；
 * - 榜单详情直接复用 PlaylistDetailScreen。
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

  // 官方榜大卡片（带 TOP 3 歌曲预览）
  const renderOfficialCard = (board: WyLeaderboardBoard) => {
    const topSongs = board.topSongs ?? [];

    return (
      <Touchable
        key={board.id}
        style={[styles.officialCard, { backgroundColor: palette.surface }]}
        onPress={() => {
          hapticLight();
          openPlaylistDetailScreen(boardToPlaylistInfo(board));
        }}
        activeScale={0.98}
        accessibilityRole="button"
        accessibilityLabel={`${board.name}，官方排行榜`}
      >
        <View style={styles.officialCoverWrap}>
          {board.coverUrl ? (
            <CachedImage uri={board.coverUrl} style={styles.officialCover} />
          ) : (
            <View style={[styles.officialCover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
              <Music2 size={32} color={palette.primary} />
            </View>
          )}
          {board.updateFrequency ? (
            <View style={styles.freqBadge}>
              <Text style={styles.freqText}>{board.updateFrequency}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.officialContent}>
          <View style={styles.officialHeader}>
            <Text style={[styles.officialTitle, { color: palette.text }]} numberOfLines={1}>
              {board.name}
            </Text>
            <ChevronRight size={16} color={palette.textSubtle} />
          </View>

          <View style={styles.officialSongsList}>
            {topSongs.length > 0 ? (
              topSongs.slice(0, 3).map((song, idx) => (
                <View key={idx} style={styles.songRow}>
                  <Text style={[styles.songIndex, { color: idx === 0 ? palette.primary : palette.textMuted }]}>
                    {idx + 1}
                  </Text>
                  <Text style={[styles.songTitle, { color: palette.text }]} numberOfLines={1}>
                    {song.title}
                    {song.artist ? (
                      <Text style={[styles.songArtist, { color: palette.textMuted }]}>
                        {"  -  " + song.artist}
                      </Text>
                    ) : null}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={[styles.noPreviewText, { color: palette.textMuted }]}>
                点击查看排行榜完整 100 首曲目
              </Text>
            )}
          </View>
        </View>
      </Touchable>
    );
  };

  // 3 列普通榜单网格卡片
  const renderGridBoard = (board: WyLeaderboardBoard) => (
    <Touchable
      key={board.id}
      style={[styles.gridCell, { backgroundColor: palette.surface }]}
      onPress={() => {
        hapticLight();
        openPlaylistDetailScreen(boardToPlaylistInfo(board));
      }}
      activeScale={0.96}
      accessibilityRole="button"
      accessibilityLabel={board.name}
    >
      <View style={styles.gridCoverWrap}>
        {board.coverUrl ? (
          <CachedImage uri={board.coverUrl} style={styles.gridCover} />
        ) : (
          <View style={[styles.gridCover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
            <Music2 size={24} color={palette.primary} />
          </View>
        )}
        {board.updateFrequency ? (
          <View style={styles.freqBadge}>
            <Text style={styles.freqText}>{board.updateFrequency}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.gridName, { color: palette.text }]}>
        {board.name}
      </Text>
    </Touchable>
  );

  return (
    <ScreenScaffold>
      <ScreenScrollView
        contentContainerStyle={styles.scrollContent}
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
        <View style={styles.titleHeader}>
          <Trophy size={22} color={palette.primary} />
          <Text style={[styles.pageTitle, { color: palette.text }]}>排行榜</Text>
        </View>

        {loading ? <LoadingState label="正在载入精彩榜单..." /> : null}
        {!loading && error ? (
          <ErrorState message={error} onRetry={() => void loadBoards()} />
        ) : null}

        {!loading && !error
          ? WY_BOARD_GROUPS.map((group) => {
              const groupBoards: WyLeaderboardBoard[] = group.boards.map((item) => {
                const enriched = boardById.get(item.id);
                return enriched ?? { id: item.id, name: item.name, group: group.key };
              });
              const isOfficial = group.key === "official";

              return (
                <View key={group.key} style={styles.section}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={[styles.sectionTitle, { color: palette.text }]}>
                      {group.title}
                    </Text>
                    {isOfficial ? (
                      <Text style={[styles.sectionHint, { color: palette.textMuted }]}>
                        热门官方数据指标
                      </Text>
                    ) : null}
                  </View>

                  {isOfficial ? (
                    <View style={styles.officialColumn}>
                      {groupBoards.map(renderOfficialCard)}
                    </View>
                  ) : (
                    <View style={styles.grid}>
                      {groupBoards.map(renderGridBoard)}
                    </View>
                  )}
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
    scrollContent: {
      paddingHorizontal: spacing.l,
      paddingBottom: spacing.xl,
    },
    titleHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginBottom: spacing.m,
      paddingTop: spacing.xs,
    },
    pageTitle: {
      fontSize: typography.heading,
      fontWeight: "700",
    },
    section: {
      marginBottom: spacing.l,
      gap: spacing.s,
    },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 2,
    },
    sectionTitle: {
      fontSize: typography.title,
      fontWeight: "700",
    },
    sectionHint: {
      fontSize: typography.caption,
    },
    officialColumn: {
      gap: spacing.m,
    },
    officialCard: {
      flexDirection: "row",
      borderRadius: radius.md,
      padding: spacing.s,
      gap: spacing.m,
      alignItems: "center",
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    officialCoverWrap: {
      width: 96,
      height: 96,
      borderRadius: radius.sm,
      overflow: "hidden",
      position: "relative",
    },
    officialCover: {
      width: "100%",
      height: "100%",
    },
    coverFallback: {
      justifyContent: "center",
      alignItems: "center",
    },
    freqBadge: {
      position: "absolute",
      top: 4,
      right: 4,
      backgroundColor: "rgba(0, 0, 0, 0.6)",
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
    },
    freqText: {
      color: "#ffffff",
      fontSize: 9,
      fontWeight: "600",
    },
    officialContent: {
      flex: 1,
      justifyContent: "center",
      gap: 6,
    },
    officialHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    officialTitle: {
      fontSize: typography.body,
      fontWeight: "700",
    },
    officialSongsList: {
      gap: 3,
    },
    songRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    songIndex: {
      fontSize: 12,
      fontWeight: "700",
      width: 14,
    },
    songTitle: {
      fontSize: 12,
      fontWeight: "500",
      flex: 1,
    },
    songArtist: {
      fontSize: 11,
    },
    noPreviewText: {
      fontSize: 12,
      paddingVertical: 4,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: spacing.m,
    },
    gridCell: {
      width: "31.5%",
      borderRadius: radius.sm,
      padding: 6,
      gap: 6,
      shadowColor: "#000",
      shadowOpacity: 0.04,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    gridCoverWrap: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: 6,
      overflow: "hidden",
      position: "relative",
    },
    gridCover: {
      width: "100%",
      height: "100%",
    },
    gridName: {
      fontSize: 12,
      fontWeight: "600",
      textAlign: "center",
    },
  });
}
