import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { ChevronRight, Music2 } from "lucide-react-native";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import { CachedImage } from "./CachedImage";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

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
        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: palette.textMuted }]}>
            {playlist.trackCount} 首
          </Text>

          {playlist.playCount && playlist.playCount > 0 && (
            <>
              <Text style={[styles.separator, { color: palette.textSubtle }]}>•</Text>
              <Text style={[styles.metaText, { color: palette.textMuted }]}>
                {formatPlayCount(playlist.playCount)}
              </Text>
            </>
          )}
          {playlist.creator && (
            <>
              <Text style={[styles.separator, { color: palette.textSubtle }]}>•</Text>
              <Text style={[styles.metaText, { color: palette.textMuted }]} numberOfLines={1}>
                {playlist.creator.nickname}
              </Text>
            </>
          )}
        </View>
      </View>

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
    gap: 12,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#8fa79f",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a3a31",
    padding: 12,
    borderRadius: 12,
    gap: 12,
  },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  coverFallback: {
    backgroundColor: "#2a4a41",
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    flex: 1,
    justifyContent: "center",
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: "#8fa79f",
  },
  separator: {
    fontSize: 12,
    color: "#5a6a67",
  },
});
