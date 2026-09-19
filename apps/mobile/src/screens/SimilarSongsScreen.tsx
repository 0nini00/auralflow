import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { ChevronLeft, Sparkles } from "lucide-react-native";
import type { MusicInfo } from "@lx/core";

import { IconButton } from "@/components/IconButton";
import { PlaybackActionButtons } from "@/components/PlaybackActionButtons";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { SongList } from "@/components/SongList";
import { getSimilarSongs } from "@/services/wyAssetService";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import {
  buildPlaylistDetailActions,
  findPlaylistCurrentSongIndex,
  shufflePlaylistSongs,
} from "@/services/playlistDetailActions";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { usePlayerStore } from "@/stores/playerStore";
import { spacing, typography } from "@/theme/tokens";

export interface SimilarSongsScreenProps {
  songId: string;
  songName: string;
  onBack?: () => void;
}

export function SimilarSongsScreen({ songId, songName, onBack }: SimilarSongsScreenProps) {
  const listRef = useRef<FlatList<MusicInfo> | null>(null);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  const currentSong = usePlayerStore((state) => state.currentSong);
  const [songs, setSongs] = useState<MusicInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const detailActions = buildPlaylistDetailActions(songs.length);
  const currentSongIndex = findPlaylistCurrentSongIndex(songs, currentSong);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getSimilarSongs(songId);
      setSongs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取相似歌曲失败");
    } finally {
      setLoading(false);
    }
  }, [songId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runPlayback = useCallback(async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
    }
  }, []);

  const handlePlay = useCallback(
    async (_song: MusicInfo, index: number) => {
      await runPlayback(() => playQueue(songs, index));
    },
    [songs, runPlayback],
  );

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    void runPlayback(() => playQueue(songs, 0));
  };

  const handleShufflePlay = () => {
    if (songs.length === 0) return;
    void runPlayback(() => playQueue(shufflePlaylistSongs(songs), 0));
  };

  const handleLocateCurrentSong = () => {
    if (currentSongIndex < 0) return;
    listRef.current?.scrollToIndex({ index: currentSongIndex, animated: true, viewPosition: 0 });
  };

  const listHeader = (
    <View style={styles.headerBlock}>
      <PlaybackErrorState message={playbackError} onDismiss={() => setPlaybackError(null)} />
      <PlaybackActionButtons
        show={detailActions.show}
        playAllLabel={detailActions.playAllLabel}
        shuffleLabel={detailActions.shuffleLabel}
        locateLabel="定位"
        canLocateCurrentSong={currentSongIndex >= 0}
        onPlayAll={handlePlayAll}
        onShuffle={handleShufflePlay}
        onLocate={handleLocateCurrentSong}
        style={styles.actions}
      />
    </View>
  );

  return (
    <ScreenScaffold>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        {onBack ? (
          <IconButton
            render={({ size, color }) => <ChevronLeft size={size} color={color} />}
            onPress={onBack}
            accessibilityLabel="返回"
          />
        ) : null}
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
            相似歌曲
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
            基于《{songName}》推荐
          </Text>
        </View>
      </View>
      <View style={styles.container}>
        {loading ? (
          <LoadingState label="正在查找相似歌曲…" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadData} />
        ) : songs.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="暂无相似歌曲"
            description="暂未找到与该歌曲风格匹配的推荐曲目"
          />
        ) : (
          <SongList
            virtualized
            listRef={listRef}
            songs={songs}
            onPlay={handlePlay}
            highlightedIndex={currentSongIndex}
            ListHeaderComponent={listHeader}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: typography.caption,
  },
  container: {
    flex: 1,
  },
  headerBlock: {
    paddingHorizontal: spacing.m,
    paddingTop: spacing.s,
  },
  actions: {
    marginBottom: spacing.s,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
});
