import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MusicInfo } from "@lx/core";
import { Music2, Play, Plus } from "lucide-react-native";

import { CachedImage } from "@/components/CachedImage";
import { Touchable } from "@/components/Touchable";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, touch, typography } from "@/theme/tokens";

export interface MusicCardProps {
  title: string;
  subtitle?: string;
  coverUrl?: string | null;
  onPlay?: () => void;
  /** 可选右上角动作（如加入歌单）；移动端常显，对齐桌面 hover 区语义 */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * 封面卡片 —— 对齐桌面 MusicCard：
 * 方封面 + 播放按钮浮层 + 标题/副标题。
 * 用于发现页「最近播放」网格等场景。
 */
export function MusicCard({
  title,
  subtitle,
  coverUrl,
  onPlay,
  actionLabel,
  onAction,
}: MusicCardProps) {
  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <Pressable
      style={styles.card}
      onPress={onPlay}
      accessibilityRole={onPlay ? "button" : undefined}
      accessibilityLabel={onPlay ? `播放 ${title}` : title}
    >
      <View style={[styles.cover, { backgroundColor: palette.surfaceStrong }]}>
        {coverUrl ? (
          <CachedImage
            uri={coverUrl}
            style={styles.coverImage}
            fallback={
              <View style={[styles.coverImage, styles.coverPlaceholder, { backgroundColor: palette.surfaceMuted }]}>
                <Music2 size={28} color={palette.primary} />
              </View>
            }
          />
        ) : (
          <View style={[styles.coverPlaceholder, { backgroundColor: palette.surfaceMuted }]}>
            <Music2 size={28} color={palette.primary} />
          </View>
        )}
        {onPlay ? (
          <Touchable
            style={[styles.playBtn, { backgroundColor: palette.primary }]}
            onPress={onPlay}
            accessibilityRole="button"
            accessibilityLabel="播放"
          >
            <Play size={18} color={palette.primaryText} fill={palette.primaryText} />
          </Touchable>
        ) : null}
      </View>

      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
            {title}
          </Text>
          {actionLabel && onAction ? (
            <Touchable
              style={[styles.actionBtn, { borderColor: palette.border, backgroundColor: palette.surface }]}
              onPress={onAction}
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
            >
              <Plus size={20} color={palette.text} />
            </Touchable>
          ) : null}
        </View>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function musicCardSubtitle(track: Pick<MusicInfo, "singer" | "albumName">): string {
  const singer = track.singer || "未知艺术家";
  return track.albumName ? `${singer} / ${track.albumName}` : singer;
}

const styles = StyleSheet.create({
  card: {
    minWidth: 0,
    flex: 1,
  },
  cover: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  coverPlaceholder: {
    flex: 1,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  playBtn: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: touch.minTarget,
    height: touch.minTarget,
    borderRadius: touch.minTarget / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    paddingTop: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: typography.body,
    fontWeight: "600",
  },
  actionBtn: {
    width: touch.minTarget,
    height: touch.minTarget,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    marginTop: 4,
    fontSize: typography.caption,
  },
});
