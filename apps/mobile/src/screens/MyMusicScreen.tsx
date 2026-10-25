import React, { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ChevronRight, Cloud, Code2, RefreshCw, Settings } from "lucide-react-native";

import { SettingsRow } from "@/components/settings/SettingsRow";
import { Touchable } from "@/components/Touchable";

import { aggregateListeningStats } from "@lx/core";

import { AccountInfo } from "@/components/AccountInfo";
import { IconButton } from "@/components/IconButton";
import { LargeHeader } from "@/components/LargeHeader";
import { QuickActionCard } from "@/components/QuickActionCard";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import {
  openCloudDriveScreen,
  openLikedSongsScreen,
  openListeningStatsScreen,
  openSettingsScreen,
} from "@/navigation/navigationRef";
import { buildLibraryQuickActions, type LibraryQuickActionType } from "@/services/libraryQuickActions";
import { SETTINGS_CATEGORY_ICONS } from "@/navigation/settingsRouteModel";
import { useAccountStore } from "@/stores/accountStore";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { useHistoryStore } from "@/stores/historyStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface MyMusicScreenProps {
  onNavigateToPlayer: () => void;
}

/**
 * 我的 —— 账号、快捷入口、服务与设置。
 *
 * 2026-10 重构：歌单与收藏已迁到「音乐库」；这里只保留「关于我」的内容，
 * 设置从抽屉搬入，顶部图标与页内「设置」入口都可直达。
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
  const statsEntries = useHistoryStore((state) => state.statsEntries);

  const weekStats = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = statsEntries.filter(
      (entry) => typeof entry.playedAt === "number" && entry.playedAt >= cutoff,
    );
    return aggregateListeningStats(recent);
  }, [statsEntries]);

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
            <Text style={[styles.statsTitle, { color: palette.text }]}>本周听歌</Text>
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
          <View style={styles.statsRow}>
            <View style={styles.statsCol}>
              <Text style={[styles.statsValue, { color: palette.text }]}>
                {formatWeekDuration(weekStats.totalMs)}
              </Text>
              <Text style={[styles.statsLabel, { color: palette.textMuted }]}>本周时长</Text>
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
        </View>

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

        <SectionHeader title="设置" style={styles.section} />
        <View style={[styles.settingsCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <SettingsRow
            icon={SETTINGS_CATEGORY_ICONS.appearance}
            title="外观"
            description="主题、强调色与背景"
            onPress={() => openSettingsScreen("Appearance")}
          />
          <SettingsRow
            icon={SETTINGS_CATEGORY_ICONS.playback}
            title="播放与音质"
            description="在线播放与下载的默认音质"
            onPress={() => openSettingsScreen("Playback")}
          />
          <SettingsRow
            icon={SETTINGS_CATEGORY_ICONS.lyrics}
            title="歌词与浮窗"
            description="沉浸歌词、悬浮歌词与字号"
            onPress={() => openSettingsScreen("Lyrics")}
          />
          <SettingsRow
            icon={Settings}
            title="全部设置"
            description="音源、同步、存储与关于"
            onPress={() => openSettingsScreen()}
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
