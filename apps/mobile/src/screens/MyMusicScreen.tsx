import React, { useEffect, useMemo } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { ChevronRight, Cloud, Code2, RefreshCw, Settings } from "lucide-react-native";

import { SettingsRow } from "@/components/settings/SettingsRow";
import { Touchable } from "@/components/Touchable";

import { addDays, aggregateListeningEvents, dayStartOf, type MusicInfo } from "@lx/core";

import { AccountInfo } from "@/components/AccountInfo";
import { IconButton } from "@/components/IconButton";
import { LargeHeader } from "@/components/LargeHeader";
import { QuickActionCard } from "@/components/QuickActionCard";
import { RecentlyPlayedSection } from "@/components/RecentlyPlayedSection";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import {
  openCloudDriveScreen,
  openHistoryScreen,
  openLikedSongsScreen,
  openListeningStatsScreen,
  openSearchScreen,
  openSettingsScreen,
} from "@/navigation/navigationRef";
import { buildLibraryQuickActions, type LibraryQuickActionType } from "@/services/libraryQuickActions";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { useAccountStore } from "@/stores/accountStore";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { useHistoryStore } from "@/stores/historyStore";
import { reportListeningStatsError, useListeningStatsStore } from "@/stores/listeningStatsStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface MyMusicScreenProps {
  onNavigateToPlayer: () => void;
}

/**
 * 我的 —— 账号、快捷入口、服务与设置。
 *
 * 2026-10 重构：歌单与收藏已迁到「音乐库」；这里只保留「关于我」的内容。
 * 设置只保留顶部齿轮一个入口，页内不再重复放「设置」列表。
 */
export function MyMusicScreen({ onNavigateToPlayer: _onNavigateToPlayer }: MyMusicScreenProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  const checkStatus = useAccountStore((state) => state.checkStatus);
  const favorites = useFavoritesStore((state) => state.favorites);
  const loadFavorites = useFavoritesStore((state) => state.loadFromStorage);
  const statsEntries = useListeningStatsStore((state) => state.events);
  const loadStats = useListeningStatsStore((state) => state.load);
  const statsError = useListeningStatsStore((state) => state.error);
  const statsWarning = useListeningStatsStore((state) => state.warning);
  const history = useHistoryStore((state) => state.history);
  const loadHistory = useHistoryStore((state) => state.loadHistory);
  useEffect(() => { void loadStats().catch(reportListeningStatsError); }, [loadStats]);
  useEffect(() => { void loadHistory().catch(() => undefined); }, [loadHistory]);

  const weekStats = useMemo(() => {
    // 按自然日对齐：和下面的 7 根柱子用同一个起点，避免「统计 8 天、图只画 7 天」。
    const cutoff = addDays(dayStartOf(Date.now()), -6);
    const recent = statsEntries.filter(
      (entry) => entry.startedAt >= cutoff,
    );
    return aggregateListeningEvents(recent);
  }, [statsEntries]);

  const weekBars = useMemo(() => {
    const byDay = new Map(weekStats.byDay.map((day) => [day.dayStart, day.totalMs]));
    const today = dayStartOf(Date.now());
    return Array.from({ length: 7 }, (_, index) => {
      const dayStart = addDays(today, index - 6);
      const date = new Date(dayStart);
      return {
        dayStart,
        ms: byDay.get(dayStart) ?? 0,
        label: "日一二三四五六"[date.getDay()],
      };
    });
  }, [weekStats.byDay]);

  const weekPeakMs = Math.max(...weekBars.map((bar) => bar.ms));
  const weekMaxMs = Math.max(1, weekPeakMs);
  const topArtist = weekStats.topArtists[0];
  const topTrack = weekStats.topTracks[0];

  const recentSongs = useMemo(() => {
    const seen = new Set<string>();
    const list: MusicInfo[] = [];
    for (const song of history) {
      const key = `${song.source}:${song.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(song);
      if (list.length >= 8) break;
    }
    return list;
  }, [history]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const quickActions = buildLibraryQuickActions({
    favoritesCount: favorites.length,
    likedCoverUri: favorites[0]?.img || favorites[0]?.picUrl || null,
  });

  const handlePlayRecent = (index: number) => {
    void runPlaybackUiAction(() => playQueue(recentSongs, index)).then((result) => {
      if (!result.ok) Alert.alert("播放失败", result.message);
    });
  };

  const handleQuickAction = (action: LibraryQuickActionType) => {
    switch (action) {
      case "openLikedPlaylist":
        openLikedSongsScreen();
        return;
      case "openListeningStats":
        openListeningStatsScreen();
        return;
    }
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView>
        <LargeHeader
          title="我的"
          style={styles.pageHeader}
          right={(
            <IconButton
              size="sm"
              tone="strong"
              accessibilityLabel="设置"
              onPress={() => openSettingsScreen()}
              render={({ size, color }) => <Settings size={size} color={color} />}
            />
          )}
        />

        <View style={styles.account}>
          <AccountInfo />
        </View>

        <View style={[styles.statsCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.statsHeader}>
            <Text style={[styles.statsTitle, { color: palette.text }]}>近 7 天听歌</Text>
            <Touchable
              onPress={openListeningStatsScreen}
              activeScale={0.97}
              accessibilityRole="button"
              accessibilityLabel="查看听歌统计"
              hitSlop={16}
              style={styles.statsMore}
            >
              <Text style={[styles.statsMoreText, { color: palette.primaryInk }]}>查看全部</Text>
              <ChevronRight size={14} color={palette.primaryInk} />
            </Touchable>
          </View>
          <Text style={[styles.statsLabel, { color: palette.textMuted }]}>本机此版本起的真实收听</Text>
          {statsError && <Text accessibilityRole="alert" style={{ color: palette.text }}>统计保存或读取失败：{statsError}</Text>}
          {statsWarning && <Text accessibilityRole="alert" style={{ color: palette.textMuted }}>{statsWarning}</Text>}
          <View style={styles.statsRow}>
            <View style={styles.statsCol}>
              <Text style={[styles.statsValue, { color: palette.text }]}>
                {formatWeekDuration(weekStats.totalMs)}
              </Text>
              <Text style={[styles.statsLabel, { color: palette.textMuted }]}>收听时长</Text>
            </View>
            <View style={[styles.statsDivider, { backgroundColor: palette.border }]} />
            <View style={styles.statsCol}>
              <Text style={[styles.statsValue, { color: palette.text }]}>{weekStats.totalPlays}</Text>
              <Text style={[styles.statsLabel, { color: palette.textMuted }]}>播放次数</Text>
            </View>
            <View style={[styles.statsDivider, { backgroundColor: palette.border }]} />
            <View style={styles.statsCol}>
              <Text style={[styles.statsValue, { color: palette.text }]}>{weekStats.topArtists.length}</Text>
              <Text style={[styles.statsLabel, { color: palette.textMuted }]}>歌手数</Text>
            </View>
          </View>
          <View
            style={styles.weekChart}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`近 7 天听歌趋势，单日最高 ${formatWeekDuration(weekPeakMs)}`}
          >
            {weekBars.map((bar) => {
              const height = bar.ms > 0 ? Math.max(6, Math.round((bar.ms / weekMaxMs) * 44)) : 3;
              return (
                <View key={bar.dayStart} style={styles.weekBarCol}>
                  <View style={[styles.weekBarTrack, { backgroundColor: palette.surfaceMuted }]}>
                    <View
                      style={[
                        styles.weekBarFill,
                        { height, backgroundColor: bar.ms > 0 ? palette.primaryInk : palette.border },
                      ]}
                    />
                  </View>
                  <Text style={[styles.weekBarLabel, { color: palette.textMuted }]}>{bar.label}</Text>
                </View>
              );
            })}
          </View>
          <View style={[styles.weekHighlight, { borderTopColor: palette.border }]}>
            <Text numberOfLines={1} style={[styles.weekHighlightText, { color: palette.text }]}>
              {topArtist ? `最常听 ${topArtist.name} · ${topArtist.plays} 次` : "本周还没有播放记录"}
            </Text>
            {topTrack ? (
              <Text numberOfLines={1} style={[styles.weekHighlightSub, { color: palette.textMuted }]}>
                本周单曲 {topTrack.song.name}
              </Text>
            ) : null}
          </View>
        </View>

        <RecentlyPlayedSection
          songs={recentSongs}
          onPlay={handlePlayRecent}
          onOpenAll={openHistoryScreen}
          onEmptyAction={openSearchScreen}
          style={styles.section}
        />

        <SectionHeader title="快捷入口" style={styles.section} />
        <View style={styles.quickActions}>
          {quickActions.map((action) => (
            <QuickActionCard
              key={action.action}
              title={action.title}
              subtitle={action.subtitle}
              coverUri={action.coverUri}
              grow
              onPress={() => handleQuickAction(action.action)}
            />
          ))}
        </View>

        <SectionHeader title="服务与同步" style={styles.section} />
        <View style={[styles.settingsCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <SettingsRow
            icon={Cloud}
            title="音乐云盘"
            description="上传、管理与播放云盘音乐"
            onPress={openCloudDriveScreen}
          />
          <SettingsRow
            icon={Code2}
            title="自定义音源"
            description="导入 LX 脚本，扩展歌曲解析"
            onPress={() => openSettingsScreen("Sources")}
          />
          <SettingsRow
            icon={RefreshCw}
            title="WebDAV 同步"
            description="把歌单与设置备份到 WebDAV"
            onPress={() => openSettingsScreen("Sync")}
            divider={false}
          />
        </View>

      </ScreenScrollView>
    </ScreenScaffold>
  );
}

function formatWeekDuration(totalMs: number): string {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return "0m";
  const hours = totalMs / 3_600_000;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  return `${Math.max(1, Math.round(totalMs / 60_000))}m`;
}

const styles = StyleSheet.create({
  pageHeader: {
    paddingHorizontal: 0,
    paddingBottom: spacing.s,
  },
  section: {
    marginBottom: spacing.m,
  },
  account: {
    marginBottom: spacing.m,
  },
  statsCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    padding: spacing.m,
    marginBottom: spacing.l,
    gap: spacing.m,
  },
  statsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statsTitle: {
    fontSize: typography.body,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  statsMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  statsMoreText: {
    fontSize: typography.micro,
    fontWeight: "600",
  },
  weekChart: {
    height: 64,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  weekBarCol: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  weekBarTrack: {
    width: "100%",
    height: 44,
    justifyContent: "flex-end",
    borderRadius: 4,
    overflow: "hidden",
  },
  weekBarFill: {
    width: "100%",
    borderRadius: 4,
  },
  weekBarLabel: {
    fontSize: typography.micro,
  },
  weekHighlight: {
    marginTop: spacing.xs,
    paddingTop: spacing.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  weekHighlightText: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
  weekHighlightSub: {
    fontSize: typography.micro,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statsCol: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  statsDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
  },
  statsValue: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    letterSpacing: -0.3,
    fontVariant: ["tabular-nums"],
  },
  statsLabel: {
    marginTop: 2,
    fontSize: typography.micro,
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.m,
    marginBottom: spacing.l,
  },
  settingsCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginBottom: spacing.l,
  },
});
