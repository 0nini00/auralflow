import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { ChevronRight, Ellipsis, Music2 } from "lucide-react-native";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import { CachedImage } from "./CachedImage";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface PlaylistListProps {
  playlists: WyPlaylistInfo[];
  onPress: (playlist: WyPlaylistInfo) => void;
  emptyText?: string;
  /** 可选：自建歌单行显示“更多”按钮（编辑/删除）。 */
  onAction?: (playlist: WyPlaylistInfo) => void;
  canAction?: (playlist: WyPlaylistInfo) => boolean;
}

export function PlaylistList({ playlists, onPress, emptyText, onAction, canAction }: PlaylistListProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  if (playlists.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>{emptyText || "暂无歌单"}</Text>
      </View>
    );
  }

  return (
    <View style={styles.listContent}>
      {playlists.map((playlist) => (
        <PlaylistItem
          key={playlist.id}
          playlist={playlist}
          onPress={() => onPress(playlist)}
          onAction={
            playlist.subscribed !== true && onAction && (canAction?.(playlist) ?? true)
              ? () => onAction(playlist)
              : undefined
          }
        />
      ))}
    </View>
  );
}

interface PlaylistItemProps {
  playlist: WyPlaylistInfo;
  onPress: () => void;
  onAction?: () => void;
}

function PlaylistItem({ playlist, onPress, onAction }: PlaylistItemProps) {
  const coverUrl = playlist.coverImgUrl || playlist.picUrl;
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <Pressable
      style={[styles.item, { backgroundColor: palette.surface }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={playlist.name}
    >
      {coverUrl ? (
        <CachedImage
          uri={coverUrl}
          style={styles.cover}
          fallback={
            <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
              <Music2 size={24} color={palette.primary} />
            </View>
          }
        />
      ) : (
        <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surfaceStrong }]}>
          <Music2 size={24} color={palette.primary} />
        </View>
      )}

      <View style={styles.info}>
        <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
          {playlist.name}
        </Text>
        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: palette.textMuted }]}>
            {playlist.trackCount} 首
          </Text>

          {playlist.playCount && playlist.playCount > 0 && (
            <>
              <Text style={[styles.separator, { color: palette.textSubtle }]}>·</Text>
              <Text style={[styles.metaText, { color: palette.textMuted }]}>
                {formatPlayCount(playlist.playCount)}
              </Text>
            </>
          )}
          {playlist.creator && (
            <>
              <Text style={[styles.separator, { color: palette.textSubtle }]}>·</Text>
              <Text style={[styles.metaText, { color: palette.textMuted }]} numberOfLines={1}>
                {playlist.creator.nickname}
              </Text>
            </>
          )}
        </View>
      </View>

      {onAction ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onAction();
          }}
          hitSlop={8}
          style={styles.actionButton}
          accessibilityRole="button"
          accessibilityLabel={`${playlist.name} 更多操作`}
        >
          <Ellipsis size={18} color={palette.textMuted} />
        </Pressable>
      ) : null}
      <ChevronRight size={20} color={palette.textMuted} />
    </Pressable>
  );
}

function formatPlayCount(count: number): string {
  if (count >= 100000000) {
    return `${(count / 100000000).toFixed(1)}亿`;
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`;
  }
  return String(count);
}

const styles = StyleSheet.create({
  listContent: {
    gap: spacing.xs,
  },
  emptyContainer: {
    paddingVertical: spacing.l,
    alignItems: "center",
  },
  emptyText: {
    fontSize: typography.meta,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.s,
    borderRadius: radius.sm,
    gap: spacing.s,
  },
  cover: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
  },
  coverFallback: {
    justifyContent: "center",
    alignItems: "center",
  },
  actionButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.xxs,
  },
  name: {
    fontSize: typography.title,
    fontWeight: "600",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  metaText: {
    fontSize: typography.caption,
  },
  separator: {
    fontSize: typography.caption,
  },
});
