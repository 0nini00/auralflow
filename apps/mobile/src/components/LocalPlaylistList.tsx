import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, Music2 } from "lucide-react-native";
import type { LocalPlaylist } from "@/services/localPlaylistModel";
import { CachedImage } from "./CachedImage";
import { getLocalPlaylistTrackCount } from "@/services/localPlaylistModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface LocalPlaylistListProps {
  playlists: LocalPlaylist[];
  onPress: (playlist: LocalPlaylist) => void;
  emptyText?: string;
}

export function LocalPlaylistList({ playlists, onPress, emptyText }: LocalPlaylistListProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  if (playlists.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>{emptyText || "暂无本地歌单"}</Text>
      </View>
    );
  }

  return (
    <View style={styles.listContent}>
      {playlists.map((playlist) => (
        <LocalPlaylistItem
          key={playlist.id}
          playlist={playlist}
          onPress={() => onPress(playlist)}
        />
      ))}
    </View>
  );
}

interface LocalPlaylistItemProps {
  playlist: LocalPlaylist;
  onPress: () => void;
}

function LocalPlaylistItem({ playlist, onPress }: LocalPlaylistItemProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const coverUrl = playlist.cover;

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
            <View style={[styles.cover, { backgroundColor: palette.surfaceStrong }]}>
              <Music2 size={24} color={palette.primary} />
            </View>
          }
        />
      ) : (
        <View style={[styles.cover, { backgroundColor: palette.surfaceStrong }]}>
          <Music2 size={24} color={palette.primary} />
        </View>
      )}
      <View style={styles.info}>
        <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
          {playlist.name}
        </Text>
        <Text style={[styles.meta, { color: palette.textMuted }]}>
          {getLocalPlaylistTrackCount(playlist)} 首
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
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    flex: 1,
    gap: spacing.xxs,
  },
  name: {
    fontSize: typography.title,
    fontWeight: "600",
  },
  meta: {
    fontSize: typography.caption,
  },
});
