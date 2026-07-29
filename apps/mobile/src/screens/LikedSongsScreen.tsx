import React from "react";
import { Alert, Pressable, type ScrollView as ScrollViewType, StyleSheet, Text, View } from "react-native";
import type { MusicInfo } from "@lx/core";

import { SongList } from "@/components/SongList";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { getContentDetailLocateScrollOffset } from "@/services/contentDetailPlaybackActions";
import { buildPlaylistDetailActions, findPlaylistCurrentSongIndex, shufflePlaylistSongs } from "@/services/playlistDetailActions";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { usePlayerStore } from "@/stores/playerStore";
import { radius, typography } from "@/theme/tokens";
import { usePlaylistStore } from "@/stores/playlistStore";

interface LikedSongsScreenProps {
  onBack: () => void;
  onNavigateToPlayer: () => void;
}

export function LikedSongsScreen({ onNavigateToPlayer }: LikedSongsScreenProps) {
  const scrollRef = React.useRef<ScrollViewType>(null);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const likedSongs = usePlaylistStore((state) => state.likedSongs);
  const unlikeSong = usePlaylistStore((state) => state.unlikeSong);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const [locatedSongIndex, setLocatedSongIndex] = React.useState<number | null>(null);
  const [playbackError, setPlaybackError] = React.useState<string | null>(null);
  const detailActions = buildPlaylistDetailActions(likedSongs.length);
  const currentSongIndex = findPlaylistCurrentSongIndex(likedSongs, currentSong);

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
    onNavigateToPlayer();
  };

  const handlePlay = async (_song: MusicInfo, index: number) => {
    await runPlayback(() => playQueue(likedSongs, index));
  };

  const handlePlayAll = async () => {
    if (likedSongs.length === 0) return;
    await runPlayback(() => playQueue(likedSongs, 0));
  };

  const handleShufflePlay = async () => {
    if (likedSongs.length === 0) return;
    await runPlayback(() => playQueue(shufflePlaylistSongs(likedSongs), 0));
  };

  const handleLocateCurrentSong = () => {
    if (currentSongIndex < 0) return;
    setLocatedSongIndex(currentSongIndex);
    scrollRef.current?.scrollTo({
      y: getContentDetailLocateScrollOffset(currentSongIndex),
      animated: true,
    });
  };

  const handleRemoveLikedSong = (song: MusicInfo) => {
    void unlikeSong(song).catch((error) => {
      Alert.alert("移除失败", error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView innerRef={scrollRef}>
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />
        <SectionHeader title="我喜欢的音乐" description={`${likedSongs.length} 首歌曲`} />

      {detailActions.show ? (
        <View style={styles.actions}>
          <Pressable style={[styles.primaryButton, { backgroundColor: palette.primary }]} onPress={handlePlayAll}>
            <Text style={[styles.primaryButtonText, { color: palette.primaryText }]}>{detailActions.playAllLabel}</Text>
          </Pressable>
          <Pressable style={[styles.secondaryButton, { backgroundColor: palette.surface }]} onPress={handleShufflePlay}>
            <Text style={[styles.secondaryButtonText, { color: palette.primary }]}>{detailActions.shuffleLabel}</Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, { backgroundColor: palette.surface }, currentSongIndex < 0 && styles.secondaryButtonDisabled]}
            onPress={handleLocateCurrentSong}
            disabled={currentSongIndex < 0}
          >
            <Text style={[styles.secondaryButtonText, { color: currentSongIndex >= 0 ? palette.primary : palette.textMuted }]}>定位当前播放</Text>
          </Pressable>
        </View>
      ) : null}

        {likedSongs.length > 0 ? (
          <SongList
            songs={likedSongs}
            onPlay={handlePlay}
            onDelete={handleRemoveLikedSong}
            emptyText="还没有喜欢的歌曲"
            highlightedIndex={locatedSongIndex}
          />
        ) : (
          <EmptyState title="还没有喜欢的歌曲" />
        )}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  primaryButtonText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  secondaryButtonDisabled: {
    opacity: 0.7,
  },
  secondaryButtonText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
});
