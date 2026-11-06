import React, { useMemo } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { ChevronRight, Music2 } from "lucide-react-native";
import type { MusicInfo } from "@lx/core";

import { CachedImage } from "@/components/CachedImage";
import { SectionHeader } from "@/components/SectionHeader";
import { Touchable } from "@/components/Touchable";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

const MAX_ITEMS = 8;

interface RecentlyPlayedSectionProps {
  songs: readonly MusicInfo[];
  onPlay: (index: number) => void;
  onOpenAll: () => void;
  onEmptyAction: () => void;
  style?: StyleProp<ViewStyle>;
}

/** 我的页「最近播放」：横向封面，点封面播放，标题右侧进完整历史。 */
export function RecentlyPlayedSection({
  songs,
  onPlay,
  onOpenAll,
  onEmptyAction,
  style,
}: RecentlyPlayedSectionProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  const items = songs.slice(0, MAX_ITEMS);

  return (
    <View style={style}>
      <SectionHeader
        title="最近播放"
        style={styles.header}
        action={items.length > 0 ? (
          <Touchable
            onPress={onOpenAll}
            activeScale={0.97}
            accessibilityRole="button"
            accessibilityLabel="查看全部播放历史"
            hitSlop={12}
            style={styles.more}
          >
            <Text style={[styles.moreText, { color: palette.primaryInk }]}>全部</Text>
            <ChevronRight size={14} color={palette.primaryInk} />
          </Touchable>
        ) : undefined}
      />

      {items.length === 0 ? (
        <Touchable
          onPress={onEmptyAction}
          activeScale={0.99}
          accessibilityRole="button"
          accessibilityLabel="还没有播放记录，去搜索音乐"
          style={[styles.empty, { backgroundColor: palette.surface, borderColor: palette.border }]}
        >
          <View style={[styles.emptyIcon, { backgroundColor: palette.surfaceMuted }]}>
            <Music2 size={20} color={palette.textMuted} />
          </View>
          <View style={styles.emptyCopy}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>还没有播放记录</Text>
            <Text style={[styles.emptyHint, { color: palette.textMuted }]}>
              去搜索一首歌，播放后会出现在这里
            </Text>
          </View>
          <ChevronRight size={18} color={palette.textMuted} />
        </Touchable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {items.map((song, index) => {
            const cover = song.picUrl || song.img;
            const singer = song.singer?.trim() || "未知歌手";
            return (
              <Touchable
                key={`${song.source}:${song.id}`}
                onPress={() => onPlay(index)}
                activeScale={0.97}
                accessibilityRole="button"
                accessibilityLabel={`播放 ${song.name}，${singer}`}
                style={styles.card}
              >
                {cover ? (
                  <CachedImage
                    uri={cover}
                    style={styles.cover}
                    fallback={(
                      <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceMuted }]}>
                        <Music2 size={22} color={palette.textMuted} />
                      </View>
                    )}
                  />
                ) : (
                  <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceMuted }]}>
                    <Music2 size={22} color={palette.textMuted} />
                  </View>
                )}
                <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>
                  {song.name}
                </Text>
                <Text numberOfLines={1} style={[styles.singer, { color: palette.textMuted }]}>
                  {singer}
                </Text>
              </Touchable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.s,
  },
  more: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  moreText: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
  row: {
    gap: spacing.s,
    paddingRight: spacing.xs,
  },
  card: {
    width: 92,
  },
  cover: {
    width: 92,
    height: 92,
    borderRadius: radius.md,
  },
  coverFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: spacing.xs,
    fontSize: typography.meta,
    fontWeight: "600",
  },
  singer: {
    marginTop: 2,
    fontSize: typography.micro,
  },
  empty: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    padding: spacing.m,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCopy: {
    flex: 1,
    minWidth: 0,
  },
  emptyTitle: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  emptyHint: {
    marginTop: 2,
    fontSize: typography.micro,
    lineHeight: 16,
  },
});
