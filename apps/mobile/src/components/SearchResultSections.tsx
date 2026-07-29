import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CachedImage } from "@/components/CachedImage";
import { buildScreenTheme, type ScreenThemeModel } from "@/services/screenThemeModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import type {
  SearchAlbumResult,
  SearchArtistResult,
  SearchPlaylistResult,
} from "@/services/musicApi";
import { layout, radius, spacing, touch, typography } from "@/theme/tokens";

export type ArtistPressHandler = (artist: SearchArtistResult) => void;
export type AlbumPressHandler = (album: SearchAlbumResult) => void;
export type PlaylistPressHandler = (playlist: SearchPlaylistResult) => void;

export interface PlaylistImportAction {
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onPress: (playlist: SearchPlaylistResult) => void;
}

interface ArtistListProps {
  artists: SearchArtistResult[];
  emptyText?: string;
  onPress?: ArtistPressHandler;
}

interface AlbumListProps {
  albums: SearchAlbumResult[];
  emptyText?: string;
  onPress?: AlbumPressHandler;
}

interface PlaylistListProps {
  playlists: SearchPlaylistResult[];
  emptyText?: string;
  onPress?: PlaylistPressHandler;
  getImportAction?: (playlist: SearchPlaylistResult) => PlaylistImportAction;
}

export function ArtistResultList({ artists, emptyText, onPress }: ArtistListProps) {
  return (
    <ResultList
      data={artists}
      emptyText={emptyText || "没有找到歌手"}
      keyExtractor={(item) => item.id}
      renderItem={(item, screenTheme) => <ArtistItem artist={item} onPress={onPress} screenTheme={screenTheme} />}
    />
  );
}

export function AlbumResultList({ albums, emptyText, onPress }: AlbumListProps) {
  return (
    <ResultList
      data={albums}
      emptyText={emptyText || "没有找到专辑"}
      keyExtractor={(item) => item.id}
      renderItem={(item, screenTheme) => <AlbumItem album={item} onPress={onPress} screenTheme={screenTheme} />}
    />
  );
}

export function PlaylistResultList({ playlists, emptyText, onPress, getImportAction }: PlaylistListProps) {
  return (
    <ResultList
      data={playlists}
      emptyText={emptyText || "没有找到歌单"}
      keyExtractor={(item) => item.id}
      renderItem={(item, screenTheme) => (
        <PlaylistItem
          playlist={item}
          onPress={onPress}
          importAction={getImportAction?.(item)}
          screenTheme={screenTheme}
        />
      )}
    />
  );
}

interface ResultListProps<T> {
  data: T[];
  emptyText: string;
  keyExtractor: (item: T) => string;
  renderItem: (item: T, screenTheme: ScreenThemeModel) => React.ReactElement;
}

function ResultList<T>({ data, emptyText, keyExtractor, renderItem }: ResultListProps<T>) {
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const screenTheme = buildScreenTheme(palette);

  if (data.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: screenTheme.bodyText }]}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <View style={styles.listContent}>
      {data.map((item) => (
        <React.Fragment key={keyExtractor(item)}>
          {renderItem(item, screenTheme)}
        </React.Fragment>
      ))}
    </View>
  );
}

function ArtistItem({
  artist,
  onPress,
  screenTheme,
}: {
  artist: SearchArtistResult;
  onPress?: ArtistPressHandler;
  screenTheme: ScreenThemeModel;
}) {
  return (
    <Pressable style={[styles.item, { backgroundColor: screenTheme.cardBackground }]} onPress={onPress ? () => onPress(artist) : undefined}>
      <Artwork uri={artist.avatarUrl} fallbackText="歌手" screenTheme={screenTheme} />
      <View style={styles.info}>
        <Text style={[styles.primaryText, { color: screenTheme.titleText }]} numberOfLines={1}>
          {artist.name}
        </Text>
        <Text style={[styles.secondaryText, { color: screenTheme.bodyText }]} numberOfLines={1}>
          {artist.alias?.length ? artist.alias.join(" / ") : `${artist.songCount || 0} 首作品`}
        </Text>
      </View>
      <Text style={[styles.sourceText, { color: screenTheme.bodyText, backgroundColor: screenTheme.strongBackground }]}>歌手</Text>
    </Pressable>
  );
}

function AlbumItem({
  album,
  onPress,
  screenTheme,
}: {
  album: SearchAlbumResult;
  onPress?: AlbumPressHandler;
  screenTheme: ScreenThemeModel;
}) {
  return (
    <Pressable style={[styles.item, { backgroundColor: screenTheme.cardBackground }]} onPress={onPress ? () => onPress(album) : undefined}>
      <Artwork uri={album.coverUrl} fallbackText="专辑" screenTheme={screenTheme} />
      <View style={styles.info}>
        <Text style={[styles.primaryText, { color: screenTheme.titleText }]} numberOfLines={1}>
          {album.name}
        </Text>
        <Text style={[styles.secondaryText, { color: screenTheme.bodyText }]} numberOfLines={1}>
          {[album.artistName, album.trackCount ? `${album.trackCount} 首` : undefined, album.publishTime]
            .filter(Boolean)
            .join(" • ")}
        </Text>
      </View>
      <Text style={[styles.sourceText, { color: screenTheme.bodyText, backgroundColor: screenTheme.strongBackground }]}>专辑</Text>
    </Pressable>
  );
}

function PlaylistItem({
  playlist,
  onPress,
  importAction,
  screenTheme,
}: {
  playlist: SearchPlaylistResult;
  onPress?: PlaylistPressHandler;
  importAction?: PlaylistImportAction;
  screenTheme: ScreenThemeModel;
}) {
  return (
    <Pressable style={[styles.item, { backgroundColor: screenTheme.cardBackground }]} onPress={onPress ? () => onPress(playlist) : undefined}>
      <Artwork uri={playlist.coverUrl} fallbackText="歌单" screenTheme={screenTheme} />
      <View style={styles.info}>
        <Text style={[styles.primaryText, { color: screenTheme.titleText }]} numberOfLines={1}>
          {playlist.name}
        </Text>
        <Text style={[styles.secondaryText, { color: screenTheme.bodyText }]} numberOfLines={1}>
          {[playlist.creatorName, playlist.trackCount ? `${playlist.trackCount} 首` : undefined, formatPlayCount(playlist.playCount)]
            .filter(Boolean)
            .join(" • ")}
        </Text>
      </View>
      {importAction ? (
        <Pressable
          style={[
            styles.importButton,
            { backgroundColor: screenTheme.mutedBackground },
            importAction.disabled && { backgroundColor: screenTheme.strongBackground },
          ]}
          disabled={importAction.disabled || importAction.loading}
          onPress={(event) => {
            event.stopPropagation();
            importAction.onPress(playlist);
          }}
        >
          <Text style={[styles.importButtonText, { color: importAction.disabled ? screenTheme.bodyText : screenTheme.primaryBackground }]}>
            {importAction.loading ? "导入中" : importAction.label}
          </Text>
        </Pressable>
      ) : (
        <Text style={[styles.sourceText, { color: screenTheme.bodyText, backgroundColor: screenTheme.strongBackground }]}>歌单</Text>
      )}
    </Pressable>
  );
}

function Artwork({ uri, fallbackText, screenTheme }: { uri?: string; fallbackText: string; screenTheme: ScreenThemeModel }) {
  if (uri) {
    return <CachedImage uri={uri} style={styles.artwork} fallback={<ArtworkFallback text={fallbackText} screenTheme={screenTheme} />} />;
  }

  return <ArtworkFallback text={fallbackText} screenTheme={screenTheme} />;
}

function ArtworkFallback({ text, screenTheme }: { text: string; screenTheme: ScreenThemeModel }) {
  return (
    <View style={[styles.artwork, styles.artworkFallback, { backgroundColor: screenTheme.strongBackground }]}>
      <Text style={[styles.artworkFallbackText, { color: screenTheme.primaryBackground }]}>{text}</Text>
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
    gap: 4,
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
    borderRadius: 4,
  },
  importButton: {
    minWidth: 52,
    minHeight: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: 10,
  },
  importButtonText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
});
