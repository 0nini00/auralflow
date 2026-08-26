import React, { useState } from "react";
import { radius, spacing, typography } from "@/theme/tokens";
import { Alert, type ScrollView as ScrollViewType, StyleSheet, View } from "react-native";
import type { MusicInfo } from "@lx/core";

import { ActionButton } from "@/components/ActionButton";
import { SongList } from "@/components/SongList";
import { DetailHero } from "@/components/DetailHero";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { ListMusic } from "lucide-react-native";

import { EmptyState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { buildPlaylistDetailActions, findPlaylistCurrentSongIndex } from "@/services/playlistDetailActions";
import { getContentDetailLocateScrollOffset } from "@/services/contentDetailPlaybackActions";
import { usePlaylistStore } from "@/stores/playlistStore";
import { usePlayerStore } from "@/stores/playerStore";

interface LocalPlaylistDetailScreenProps {
  playlistId: string;
  onBack: () => void;
  onNavigateToPlayer: () => void;
  onOpenPlaylist?: (playlistId: string) => void;
}

export function LocalPlaylistDetailScreen({ playlistId, onBack, onNavigateToPlayer, onOpenPlaylist }: LocalPlaylistDetailScreenProps) {
  const scrollRef = React.useRef<ScrollViewType>(null);
  const playlist = usePlaylistStore((state) => state.localPlaylists.find((item) => item.id === playlistId));
  const deleteLocalPlaylist = usePlaylistStore((state) => state.deleteLocalPlaylist);
  const removeSongFromLocalPlaylist = usePlaylistStore((state) => state.removeSongFromLocalPlaylist);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const [locatedSongIndex, setLocatedSongIndex] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const detailActions = buildPlaylistDetailActions(playlist?.songs.length ?? 0);
  const currentSongIndex = playlist ? findPlaylistCurrentSongIndex(playlist.songs, currentSong) : -1;
  if (!playlist) {
    return (
      <ScreenScaffold>
        <View style={styles.missingState}>
          <EmptyState icon={ListMusic} title="本地歌单不存在" description="歌单可能已被删除，返回曲库查看其他歌单。" />
        </View>
      </ScreenScaffold>
    );
  }
  const coverUrl = playlist.cover;

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  };

  const handlePlay = async (_song: MusicInfo, index: number) => {
    await runPlayback(() => playQueue(playlist.songs, index));
  };

  const handlePlayAll = async () => {
    if (playlist.songs.length === 0) return;
    await runPlayback(() => playQueue(playlist.songs, 0));
  };

  const handleLocateCurrentSong = () => {
    if (currentSongIndex < 0) return;
    setLocatedSongIndex(currentSongIndex);
    scrollRef.current?.scrollTo({
      y: getContentDetailLocateScrollOffset(currentSongIndex),
      animated: true,
    });
  };

  const handleDeletePlaylist = () => {
    Alert.alert("删除本地歌单", `确定删除「${playlist.name}」吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void deleteLocalPlaylist(playlist.id)
            .then(onBack)
            .catch((error) => Alert.alert("删除失败", error instanceof Error ? error.message : String(error)));
        },
      },
    ]);
  };

  const handleRemoveSong = (song: MusicInfo) => {
    void removeSongFromLocalPlaylist(playlist.id, song).catch((error) => {
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
        <DetailHero
          actionsFullBleed
          imageUrl={coverUrl}
          title={playlist.name}
          subtitle={playlist.description}
          metadata={[`${playlist.songs.length} 首歌曲`]}
          actions={
            <View style={styles.heroActions}>
              <ActionButton small grow variant="primary" label={detailActions.playAllLabel} onPress={() => void handlePlayAll()} />
              <ActionButton small grow variant="primary" label="定位歌曲" disabled={currentSongIndex < 0} onPress={handleLocateCurrentSong} />
              <ActionButton small grow variant="danger" label="删除歌单" onPress={handleDeletePlaylist} />
            </View>
          }
        />

        <View style={styles.songSection}>
          <SectionHeader title="歌曲" description={`${playlist.songs.length} 首`} />
          {playlist.songs.length > 0 ? (
            <SongList
              songs={playlist.songs}
              onPlay={handlePlay}
              onDelete={(song) => handleRemoveSong(song)}
              emptyText="还没有歌曲，点击添加歌曲，导入本地音乐"
              highlightedIndex={locatedSongIndex}
              hideSourceTag
            />
          ) : (
            <EmptyState
              title="还没有歌曲"
              description="点击添加歌曲，导入本地音乐。"
            />
          )}
        </View>

      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  modalScrollContent: {
    padding: spacing.l,
  },
  missingState: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  heroActions: {
    // 三键一排平分整个内容宽度（由 DetailHero actionsFullBleed 整行承载），不再缩在歌单名右侧
    flexGrow: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  songSection: {
    gap: spacing.s,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: "center",
    gap: spacing.s,
  },
  emptyText: {
    fontSize: typography.body,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  modalCard: {
    borderRadius: radius.lg,
    padding: spacing.l,
    gap: spacing.m,
  },
  modalTitle: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: typography.title,
  },
  textArea: {
    minHeight: 76,
    textAlignVertical: "top",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.s,
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.m,
  },
  closeText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  addSongItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.s,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
    gap: spacing.s,
  },
  addSongInfo: {
    flex: 1,
    gap: spacing.xxs,
  },
  addSongName: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  addSongMeta: {
    fontSize: typography.caption,
  },
  addSongAction: {
    fontSize: typography.body,
    fontWeight: "700",
  },
});
