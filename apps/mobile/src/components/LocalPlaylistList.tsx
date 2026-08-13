import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, Music2 } from "lucide-react-native";
import type { LocalPlaylist } from "@/services/localPlaylistModel";
import { CachedImage } from "./CachedImage";
import {
  LOCAL_PLAYLIST_LIST_ACTIONS,
  type LocalPlaylistListActionType,
} from "@/services/localPlaylistListActions";
import { buildLocalPlaylistListMeta } from "@/services/localPlaylistListMetaModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface LocalPlaylistListProps {
  playlists: LocalPlaylist[];
  onPress: (playlist: LocalPlaylist) => void;
  onAction?: (playlist: LocalPlaylist, action: LocalPlaylistListActionType) => void;
  emptyText?: string;
}

export function LocalPlaylistList({ playlists, onPress, onAction, emptyText }: LocalPlaylistListProps) {
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
          onAction={onAction}
        />
      ))}
    </View>
  );
}

interface LocalPlaylistItemProps {
  playlist: LocalPlaylist;
  onPress: () => void;
  onAction?: (playlist: LocalPlaylist, action: LocalPlaylistListActionType) => void;
}

function LocalPlaylistItem({ playlist, onPress, onAction }: LocalPlaylistItemProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const metaText = buildLocalPlaylistListMeta(playlist);
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
        {playlist.description ? (
          <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={1}>
            {playlist.description}
          </Text>
        ) : null}
        <Text style={[styles.meta, { color: palette.textMuted }]}>{metaText}</Text>
        {onAction ? (
          <View style={styles.actions}>
            {LOCAL_PLAYLIST_LIST_ACTIONS.map((action) => (
              <Pressable
                key={action.type}
                style={[
                  styles.actionButton,
                  { backgroundColor: action.destructive ? palette.dangerSurface : palette.surfaceStrong },
                ]}
                onPress={(event) => {
                  event.stopPropagation();
                  onAction(playlist, action.type);
                }}
              >
                <Text style={[styles.actionText, { color: action.destructive ? palette.danger : palette.primary }]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
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
  description: {
    fontSize: typography.caption,
  },
  meta: {
    fontSize: typography.caption,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  actionButton: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 5,
  },
  actionText: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
});
