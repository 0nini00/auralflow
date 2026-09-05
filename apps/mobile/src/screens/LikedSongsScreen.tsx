import React from "react";
import { FlatList, StyleSheet } from "react-native";
import type { MusicInfo } from "@lx/core";

import { PlaybackActionButtons } from "@/components/PlaybackActionButtons";
import { SongList } from "@/components/SongList";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { Heart } from "lucide-react-native";

import { EmptyState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { buildPlaylistDetailActions, findPlaylistCurrentSongIndex, shufflePlaylistSongs } from "@/services/playlistDetailActions";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { usePlayerStore } from "@/stores/playerStore";
import { layout, spacing } from "@/theme/tokens";
import { useFavoritesStore } from "@/stores/favoritesStore";

interface LikedSongsScreenProps {
  onBack: () => void;
  onNavigateToPlayer: () => void;
}

/**
 * 我喜欢的音乐（本地收藏，对齐桌面端 /playlist/favorites）：
 * 歌曲列表心形加入/移出本地收藏，与网易云红心无关。
 *
 * 列表虚拟化：SongList 本体即滚动容器，头部内容经 ListHeaderComponent 随列表滚动。
 */
export function LikedSongsScreen({ onNavigateToPlayer }: LikedSongsScreenProps) {
  const listRef = React.useRef<FlatList<MusicInfo> | null>(null);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const favorites = useFavoritesStore((state) => state.favorites);
  const removeFavorite = useFavoritesStore((state) => state.removeFavorite);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const [locatedSongIndex, setLocatedSongIndex] = React.useState<number | null>(null);
  const [playbackError, setPlaybackError] = React.useState<string | null>(null);
  const detailActions = buildPlaylistDetailActions(favorites.length);
  const currentSongIndex = findPlaylistCurrentSongIndex(favorites, currentSong);

  const runPlayback = React.useCallback(async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  }, []);

  // useCallback：SongList 的 memo 行依赖 onPlay，引用不稳定会让全部行失去 memo 意义
  const handlePlay = React.useCallback(
    async (_song: MusicInfo, index: number) => {
      await runPlayback(() => playQueue(favorites, index));
    },
    [favorites, runPlayback],
  );

  const handlePlayAll = () => {
    if (favorites.length === 0) return;
    void runPlayback(() => playQueue(favorites, 0));
  };

  const handleShufflePlay = () => {
    if (favorites.length === 0) return;
    void runPlayback(() => playQueue(shufflePlaylistSongs(favorites), 0));
  };

  const handleLocateCurrentSong = () => {
    if (currentSongIndex < 0) return;
    setLocatedSongIndex(currentSongIndex);
    listRef.current?.scrollToIndex({ index: currentSongIndex, animated: true, viewPosition: 0 });
  };

  const listHeader = (
    <>
      <PlaybackErrorState
        message={playbackError}
        onDismiss={() => setPlaybackError(null)}
      />
      <SectionHeader title="我喜欢的音乐" description={`${favorites.length} 首歌曲`} />

      <PlaybackActionButtons
        show={detailActions.show}
        playAllLabel={detailActions.playAllLabel}
        shuffleLabel={detailActions.shuffleLabel}
        locateLabel="定位歌曲"
        canLocateCurrentSong={currentSongIndex >= 0}
        onPlayAll={handlePlayAll}
        onShuffle={handleShufflePlay}
        onLocate={handleLocateCurrentSong}
        style={[styles.actions, styles.actionsRowOverride]}
      />
    </>
  );

  return (
    <ScreenScaffold>
      <SongList
        virtualized
        listRef={listRef}
        songs={favorites}
        onPlay={handlePlay}
        highlightedIndex={locatedSongIndex ?? currentSongIndex}
        ListHeaderComponent={listHeader}
        ListFooterComponent={
          favorites.length > 0 ? null : (
            <EmptyState icon={Heart} title="还没有喜欢的歌曲" description="在歌曲列表或播放页点击喜欢按钮，喜欢的歌都会收在这里。" />
          )
        }
        contentContainerStyle={styles.listContent}
      />
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: {
    marginBottom: spacing.m,
  },
  // PB 行的 flexGrow: 1 在 DetailHero 横排容器里表示"主按钮撑满剩余宽度"，
  // 直接放进纵向滚动容器会变成纵向撑满整屏（按钮悬在半空、列表被推走），此处关掉
  actionsRowOverride: {
    flexGrow: 0,
  },
  // 对齐 ScreenScrollView 的页面内边距约定
  listContent: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xs,
    paddingBottom: spacing.l,
  },
});
