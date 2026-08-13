import React from "react";
import { Alert, type ScrollView as ScrollViewType, StyleSheet } from "react-native";
import type { MusicInfo } from "@lx/core";

import { PlaybackActionButtons } from "@/components/PlaybackActionButtons";
import { SongList } from "@/components/SongList";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { Heart } from "lucide-react-native";

import { EmptyState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { getContentDetailLocateScrollOffset } from "@/services/contentDetailPlaybackActions";
import { buildPlaylistDetailActions, findPlaylistCurrentSongIndex, shufflePlaylistSongs } from "@/services/playlistDetailActions";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { usePlayerStore } from "@/stores/playerStore";
import { spacing } from "@/theme/tokens";
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

      <PlaybackActionButtons
        show={detailActions.show}
        playAllLabel={detailActions.playAllLabel}
        shuffleLabel={detailActions.shuffleLabel}
        locateLabel="定位当前播放"
        canLocateCurrentSong={currentSongIndex >= 0}
        onPlayAll={() => void handlePlayAll()}
        onShuffle={() => void handleShufflePlay()}
        onLocate={handleLocateCurrentSong}
        style={styles.actions}
      />

        {likedSongs.length > 0 ? (
          <SongList
            songs={likedSongs}
            onPlay={handlePlay}
            onDelete={handleRemoveLikedSong}
            emptyText="还没有喜欢的歌曲"
            highlightedIndex={locatedSongIndex ?? currentSongIndex}
          />
        ) : (
          <EmptyState icon={Heart} title="还没有喜欢的歌曲" description="在歌曲列表或播放页点击 ♥ 图标，喜欢的歌都会收在这里。" />
        )}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: {
    marginBottom: spacing.l,
  },
});
