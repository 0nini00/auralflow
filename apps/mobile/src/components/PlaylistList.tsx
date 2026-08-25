import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { ChevronRight, Music2 } from "lucide-react-native";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import { CachedImage } from "./CachedImage";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface PlaylistListProps {
  playlists: WyPlaylistInfo[];
  onPress: (playlist: WyPlaylistInfo) => void;
  emptyText?: string;
}

export function PlaylistList({ playlists, onPress, emptyText }: PlaylistListProps) {
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
        />
      ))}
    </View>
  );
}

interface PlaylistItemProps {
  playlist: WyPlaylistInfo;
  onPress: () => void;
}

function PlaylistItem({ playlist, onPress }: PlaylistItemProps) {
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
        <Text style={[styles.metaText, { color: palette.textMuted }]}>
          {playlist.trackCount} 首
        </Text>
      </View>

      <ChevronRight size={20} color={palette.textMuted} />
    </Pressable>
  );
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
  metaText: {
    fontSize: typography.caption,
  },
});
