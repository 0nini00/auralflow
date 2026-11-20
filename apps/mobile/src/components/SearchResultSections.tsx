import React from "react";
import { FlatList, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { ActionButton } from "@/components/ActionButton";
import { CachedImage } from "@/components/CachedImage";
import { Touchable } from "@/components/Touchable";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import type { ThemePalette } from "@/services/themePaletteModel";
import type {
  SearchAlbumResult,
  SearchArtistResult,
  SearchPlaylistResult,
} from "@/services/musicApi";
import { layout, radius, spacing, typography } from "@/theme/tokens";

export type ArtistPressHandler = (artist: SearchArtistResult) => void;
export type AlbumPressHandler = (album: SearchAlbumResult) => void;
export type PlaylistPressHandler = (playlist: SearchPlaylistResult) => void;

export interface PlaylistImportAction {
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onPress: (playlist: SearchPlaylistResult) => void;
}

interface VirtualResultProps {
  virtualized?: boolean;
  ListHeaderComponent?: React.ReactElement | null;
  ListFooterComponent?: React.ReactElement | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

interface ArtistListProps extends VirtualResultProps {
  artists: SearchArtistResult[];
  emptyText?: string;
  onPress?: ArtistPressHandler;
}

interface AlbumListProps extends VirtualResultProps {
  albums: SearchAlbumResult[];
  emptyText?: string;
  onPress?: AlbumPressHandler;
}

interface PlaylistListProps extends VirtualResultProps {
  playlists: SearchPlaylistResult[];
  emptyText?: string;
  onPress?: PlaylistPressHandler;
  getImportAction?: (playlist: SearchPlaylistResult) => PlaylistImportAction;
}

export function ArtistResultList({ artists, emptyText, onPress, ...listProps }: ArtistListProps) {
  return (
    <ResultList
      {...listProps}
      data={artists}
      emptyText={emptyText || "没有找到歌手"}
      keyExtractor={(item) => item.id}
      renderItem={(item, palette) => <ArtistItem artist={item} onPress={onPress} palette={palette} />}
    />
  );
}

export function AlbumResultList({ albums, emptyText, onPress, ...listProps }: AlbumListProps) {
  return (
    <ResultList
      {...listProps}
      data={albums}
      emptyText={emptyText || "没有找到专辑"}
      keyExtractor={(item) => item.id}
      renderItem={(item, palette) => <AlbumItem album={item} onPress={onPress} palette={palette} />}
    />
  );
}

export function PlaylistResultList({ playlists, emptyText, onPress, getImportAction, ...listProps }: PlaylistListProps) {
  return (
    <ResultList
      {...listProps}
      data={playlists}
      emptyText={emptyText || "没有找到歌单"}
      keyExtractor={(item) => item.id}
      renderItem={(item, palette) => (
        <PlaylistItem
          playlist={item}
          onPress={onPress}
          importAction={getImportAction?.(item)}
          palette={palette}
        />
      )}
    />
  );
}

interface ResultListProps<T> extends VirtualResultProps {
  data: T[];
  emptyText: string;
  keyExtractor: (item: T) => string;
  renderItem: (item: T, palette: ThemePalette) => React.ReactElement;
}

function ResultList<T>({ data, emptyText, keyExtractor, renderItem, virtualized, ...listProps }: ResultListProps<T>) {
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);

  const empty = (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>{emptyText}</Text>
      </View>
  );
  if (virtualized) {
    return <FlatList
      {...listProps}
      data={data}
      keyExtractor={keyExtractor}
      renderItem={({ item }) => renderItem(item, palette)}
      ListEmptyComponent={empty}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
    />;
  }
  if (data.length === 0) return empty;

  return (
    <View style={styles.listContent}>
      {data.map((item) => (
        <React.Fragment key={keyExtractor(item)}>
          {renderItem(item, palette)}
        </React.Fragment>
      ))}
    </View>
  );
}

function ArtistItem({
  artist,
  onPress,
  palette,
}: {
  artist: SearchArtistResult;
  onPress?: ArtistPressHandler;
  palette: ThemePalette;
}) {
  return (
    <Touchable style={[styles.item, { backgroundColor: palette.surface }]} onPress={onPress ? () => onPress(artist) : undefined}>
      <Artwork uri={artist.avatarUrl} fallbackText="歌手" palette={palette} />
      <View style={styles.info}>
        <Text style={[styles.primaryText, { color: palette.text }]} numberOfLines={1}>
          {artist.name}
        </Text>
        <Text style={[styles.secondaryText, { color: palette.textMuted }]} numberOfLines={1}>
          {artist.alias?.length ? artist.alias.join(" / ") : `${artist.songCount || 0} 首作品`}
        </Text>
      </View>
      <Text style={[styles.sourceText, { color: palette.textMuted, backgroundColor: palette.surfaceStrong }]}>歌手</Text>
    </Touchable>
  );
}

function AlbumItem({
  album,
  onPress,
  palette,
}: {
  album: SearchAlbumResult;
  onPress?: AlbumPressHandler;
  palette: ThemePalette;
}) {
  return (
    <Touchable style={[styles.item, { backgroundColor: palette.surface }]} onPress={onPress ? () => onPress(album) : undefined}>
      <Artwork uri={album.coverUrl} fallbackText="专辑" palette={palette} />
      <View style={styles.info}>
        <Text style={[styles.primaryText, { color: palette.text }]} numberOfLines={1}>
          {album.name}
        </Text>
        <Text style={[styles.secondaryText, { color: palette.textMuted }]} numberOfLines={1}>
          {[album.artistName, album.trackCount ? `${album.trackCount} 首` : undefined, album.publishTime]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <Text style={[styles.sourceText, { color: palette.textMuted, backgroundColor: palette.surfaceStrong }]}>专辑</Text>
    </Touchable>
  );
}

function PlaylistItem({
  playlist,
  onPress,
  importAction,
  palette,
}: {
  playlist: SearchPlaylistResult;
  onPress?: PlaylistPressHandler;
  importAction?: PlaylistImportAction;
  palette: ThemePalette;
}) {
  return (
    <Touchable
      style={[styles.item, { backgroundColor: palette.surface }]}
      onPress={onPress ? () => onPress(playlist) : undefined}
    >
      <Artwork uri={playlist.coverUrl} fallbackText="歌单" palette={palette} />
      <View style={styles.info}>
        <Text style={[styles.primaryText, { color: palette.text }]} numberOfLines={1}>
          {playlist.name}
        </Text>
        <Text style={[styles.secondaryText, { color: palette.textMuted }]} numberOfLines={1}>
          {[playlist.creatorName, playlist.trackCount ? `${playlist.trackCount} 首` : undefined, formatPlayCount(playlist.playCount)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      {importAction ? (
        <ActionButton
          label={importAction.loading ? "导入中" : importAction.label}
          variant="secondary"
          small
          disabled={importAction.disabled || importAction.loading}
          onPress={() => importAction.onPress(playlist)}
        />
      ) : (
        <Text style={[styles.sourceText, { color: palette.textMuted, backgroundColor: palette.surfaceStrong }]}>歌单</Text>
      )}
    </Touchable>
  );
}

function Artwork({ uri, fallbackText, palette }: { uri?: string; fallbackText: string; palette: ThemePalette }) {
  if (uri) {
    return <CachedImage uri={uri} style={styles.artwork} fallback={<ArtworkFallback text={fallbackText} palette={palette} />} />;
  }

  return <ArtworkFallback text={fallbackText} palette={palette} />;
}

function ArtworkFallback({ text, palette }: { text: string; palette: ThemePalette }) {
  return (
    <View style={[styles.artwork, styles.artworkFallback, { backgroundColor: palette.surfaceStrong }]}>
      <Text style={[styles.artworkFallbackText, { color: palette.primaryInk }]}>{text}</Text>
    </View>
  );
}

function formatPlayCount(count?: number): string | undefined {
  if (!count) return undefined;
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
    paddingVertical: 32,
    alignItems: "center",
  },
  emptyText: {
    fontSize: typography.body,
  },
  item: {
    minHeight: layout.songRowMinHeight,
    flexDirection: "row",
    alignItems: "center",
    padding: layout.songRowPadding,
    borderRadius: radius.sm,
    gap: spacing.s,
  },
  artwork: {
    width: layout.artworkSize,
    height: layout.artworkSize,
    borderRadius: radius.sm,
  },
  artworkFallback: {
    justifyContent: "center",
    alignItems: "center",
  },
  artworkFallbackText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  info: {
    flex: 1,
    gap: spacing.xxs,
  },
  primaryText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  secondaryText: {
    fontSize: typography.caption,
  },
  sourceText: {
    fontSize: typography.caption,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
});
