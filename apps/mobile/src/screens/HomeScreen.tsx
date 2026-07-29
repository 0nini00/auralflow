import React, { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { MusicInfo } from "@lx/core";

import { MusicCard, musicCardSubtitle } from "@/components/MusicCard";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { useHistoryStore } from "@/stores/historyStore";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { buildHomeSongActions } from "@/services/homeSongActions";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

interface HomeScreenProps {
  onNavigateToPlayer: () => void;
  onNavigateToSearch: () => void;
  /** 跳到私人 FM（独立路由，对齐桌面 /fm） */
  onNavigateToFm?: () => void;
  /** 跳到曲库历史分区，查看完整最近播放 */
  onNavigateToHistory?: () => void;
}

/**
 * 发现页 —— 对齐桌面 HomeView：
 * 1. Hero：品牌文案 + 私人 FM / 搜索音乐 快捷入口
 * 2. 最近播放：封面卡片网格（非列表行）
 *
 * 每日推荐 / 私人 FM 走独立抽屉路由，不再内嵌在 Home 的 mode 状态里。
 */
export function HomeScreen({
  onNavigateToPlayer,
  onNavigateToSearch,
  onNavigateToFm,
  onNavigateToHistory,
}: HomeScreenProps) {
  const history = useHistoryStore((state) => state.history);
  const songActions = buildHomeSongActions(history);
  const { width } = useWindowDimensions();

  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // 对齐桌面 auto-fill minmax(150/120)：窄屏 2 列，宽屏 3-4 列
  const gap = 14;
  const contentWidth = Math.max(
    0,
    width - spacing.l * 2 - StyleSheet.hairlineWidth * 2,
  );
  const columns = contentWidth >= 720 ? 4 : contentWidth >= 480 ? 3 : 2;
  const cardWidth = Math.max(0, (contentWidth - gap * (columns - 1)) / columns);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          gap: 28,
        },
        hero: {
          borderRadius: radius.xl,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          backgroundColor: palette.surface,
          padding: 24,
          gap: 18,
          overflow: "hidden",
        },
        heroAccentBar: {
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: palette.primary,
          opacity: 0.85,
        },
        eyebrow: {
          color: palette.primary,
          fontSize: typography.caption,
          fontWeight: "700",
          letterSpacing: 1.2,
          textTransform: "uppercase",
          marginBottom: 8,
        },
        heroTitle: {
          fontSize: typography.display,
          fontWeight: "700",
          color: palette.text,
          letterSpacing: -0.4,
          marginBottom: 8,
        },
        heroText: {
          fontSize: typography.body,
          color: palette.textMuted,
          lineHeight: 21,
        },
        heroActions: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 10,
        },
        primaryAction: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderRadius: radius.pill,
          minHeight: touch.minTarget,
          paddingHorizontal: 16,
          paddingVertical: 11,
          backgroundColor: palette.primary,
        },
        primaryActionText: {
          color: palette.primaryText,
          fontSize: typography.body,
          fontWeight: "600",
        },
        secondaryAction: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderRadius: radius.pill,
          minHeight: touch.minTarget,
          paddingHorizontal: 16,
          paddingVertical: 11,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          backgroundColor: palette.surfaceMuted,
        },
        secondaryActionText: {
          color: palette.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        section: {
          minWidth: 0,
          gap: 14,
        },
        sectionActions: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        sectionAction: {
          borderRadius: radius.pill,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          backgroundColor: palette.surface,
          minHeight: touch.minTarget,
          justifyContent: "center",
          paddingHorizontal: 12,
          paddingVertical: 8,
        },
        sectionActionText: {
          color: palette.textMuted,
          fontSize: typography.meta,
          fontWeight: "500",
        },
        grid: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap,
        },
        gridItem: {
          width: cardWidth,
        },
      }),
    [palette, cardWidth, gap],
  );

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
    await runPlayback(() => playQueue(songActions.playAllSongs, index));
  };

  const handlePlayAll = async () => {
    if (!songActions.showPlayAll || songActions.playAllSongs.length === 0) return;
    await runPlayback(() => playQueue(songActions.playAllSongs, 0));
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.container}>
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />
        <View style={styles.hero}>
        <View style={styles.heroAccentBar} />
        <View>
          <Text style={styles.eyebrow}>AuralFlow</Text>
          <Text style={styles.heroTitle}>发现音乐</Text>
          <Text style={styles.heroText}>
            从搜索、本地曲库和私人 FM 开始，把想听的歌快速接到播放队列里。
          </Text>
        </View>
        <View style={styles.heroActions}>
          <Pressable
            style={styles.primaryAction}
            onPress={() => onNavigateToFm?.()}
            accessibilityRole="button"
            accessibilityLabel="私人 FM"
          >
            <Text style={styles.primaryActionText}>私人 FM</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryAction}
            onPress={onNavigateToSearch}
            accessibilityRole="button"
            accessibilityLabel="搜索音乐"
          >
            <Text style={styles.secondaryActionText}>搜索音乐</Text>
          </Pressable>
        </View>
        </View>

        <View style={styles.section}>
          <SectionHeader
            title={songActions.title}
            action={(
              <View style={styles.sectionActions}>
            {songActions.showViewAll && onNavigateToHistory ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={songActions.viewAllLabel}
                style={styles.sectionAction}
                onPress={onNavigateToHistory}
              >
                <Text style={styles.sectionActionText}>{songActions.viewAllLabel}</Text>
              </Pressable>
            ) : null}
            {songActions.showPlayAll ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={songActions.playAllLabel}
                style={styles.sectionAction}
                onPress={() => void handlePlayAll()}
              >
                <Text style={styles.sectionActionText}>{songActions.playAllLabel}</Text>
              </Pressable>
            ) : null}
              </View>
            )}
          />

          {songActions.songs.length === 0 ? (
            <EmptyState title={songActions.emptyText} description={songActions.emptyCaption} />
          ) : (
            <View style={styles.grid}>
              {songActions.songs.map((track, index) => (
                <View key={`${track.source}:${track.id}:${index}`} style={styles.gridItem}>
                  <MusicCard
                    title={track.name}
                    subtitle={musicCardSubtitle(track)}
                    coverUrl={track.img || track.picUrl}
                    onPlay={() => void handlePlay(track, index)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScreenScrollView>
    </ScreenScaffold>
  );
}
