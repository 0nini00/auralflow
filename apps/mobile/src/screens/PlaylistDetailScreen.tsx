import React, { useEffect, useRef, useState } from "react";
import { radius, typography } from "@/theme/tokens";
import {
  Alert,
  type ScrollView as ScrollViewType,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";
import type { MusicInfo } from "@lx/core";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { useAccountStore } from "@/stores/accountStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { usePlayerStore } from "@/stores/playerStore";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import {
  buildPlaylistDetailActions,
  canRemoveSongsFromPlaylistDetail,
  findPlaylistCurrentSongIndex,
  shufflePlaylistSongs,
} from "@/services/playlistDetailActions";
import { SongList } from "@/components/SongList";
import { DetailHero } from "@/components/DetailHero";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import {
  buildImportedSourcePlaylist,
  getSourcePlaylistImportStatus,
  type ImportablePlaylistSource,
} from "@/services/searchPlaylistImportModel";

function isImportablePlaylistSource(source: WyPlaylistInfo["source"]): source is ImportablePlaylistSource {
  return source === "wy" || source === "tx";
}

interface PlaylistDetailScreenProps {
  playlist: WyPlaylistInfo;
  onBack: () => void;
  onNavigateToPlayer: () => void;
}

export function PlaylistDetailScreen({
  playlist,
  onBack,
  onNavigateToPlayer,
}: PlaylistDetailScreenProps) {
  const scrollRef = useRef<ScrollViewType>(null);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [removingSongKey, setRemovingSongKey] = useState<string | null>(null);
  const [locatedSongIndex, setLocatedSongIndex] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const user = useAccountStore((state) => state.user);
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const currentPlaylistSongs = usePlaylistStore((state) => state.currentPlaylistSongs);
  const likedPlaylist = usePlaylistStore((state) => state.likedPlaylist);
  const likedSongs = usePlaylistStore((state) => state.likedSongs);
  const localPlaylists = usePlaylistStore((state) => state.localPlaylists);
  const loading = usePlaylistStore((state) => state.loading);
  const error = usePlaylistStore((state) => state.error);
  const createLocalPlaylistWithSongs = usePlaylistStore((state) => state.createLocalPlaylistWithSongs);
  const removeSongFromWyPlaylist = usePlaylistStore((state) => state.removeSongFromWyPlaylist);
  const setWyPlaylistSubscribed = usePlaylistStore((state) => state.setWyPlaylistSubscribed);
  const fetchPlaylistDetail = usePlaylistStore(
    (state) => state.fetchPlaylistDetail
  );
  const currentSong = usePlayerStore((state) => state.currentSong);

  const isLikedPlaylist = likedPlaylist?.id === playlist.id;
  const songs = isLikedPlaylist ? likedSongs : currentPlaylistSongs;
  const displayPlaylist = isLikedPlaylist && likedPlaylist ? likedPlaylist : playlist;
  const importablePlaylist = isImportablePlaylistSource(displayPlaylist.source)
    ? { ...displayPlaylist, source: displayPlaylist.source }
    : null;

  useEffect(() => {
    fetchPlaylistDetail(playlist.id, playlist.source, playlist);
  }, [playlist, fetchPlaylistDetail]);

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
    await runPlayback(() => playQueue(songs, index));
  };

  const handlePlayAll = async () => {
    if (songs.length === 0) return;
    await runPlayback(() => playQueue(songs, 0));
  };

  const detailActions = buildPlaylistDetailActions(songs.length, {
    source: displayPlaylist.source,
    refreshing,
  });
  const currentSongIndex = findPlaylistCurrentSongIndex(songs, currentSong);
  const canSubscribeWyPlaylist = displayPlaylist.source === "wy" && displayPlaylist.subscribed !== true;
  const canUnsubscribeWyPlaylist = displayPlaylist.source === "wy" && displayPlaylist.subscribed === true;
  const canRemoveSongs = canRemoveSongsFromPlaylistDetail({
    source: displayPlaylist.source,
    subscribed: displayPlaylist.subscribed,
  });
  const importStatus = importablePlaylist
    ? getSourcePlaylistImportStatus(importablePlaylist, localPlaylists)
    : { imported: false, label: "导入" };

  const handleShufflePlay = async () => {
    if (songs.length === 0) return;
    await runPlayback(() => playQueue(shufflePlaylistSongs(songs), 0));
  };

  const handleImportPlaylist = async () => {
    if (!importablePlaylist || importing || importStatus.imported || songs.length === 0) return;
    setImporting(true);
    try {
      const importedPlaylist = buildImportedSourcePlaylist(importablePlaylist, songs);
      await createLocalPlaylistWithSongs(importedPlaylist);
      Alert.alert("导入成功", `已导入「${displayPlaylist.name}」到本地歌单`);
    } catch (err) {
      Alert.alert("导入失败", err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleRefresh = async () => {
    if (!detailActions.showRefresh || refreshing || loading) return;
    setRefreshing(true);
    try {
      await fetchPlaylistDetail(playlist.id, playlist.source, playlist);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSetWyPlaylistSubscribed = async (subscribed: boolean) => {
    if (subscribing) return;
    if (!isLoggedIn || !user) {
      Alert.alert("需要登录", "请先登录网易云账号");
      return;
    }

    setSubscribing(true);
    try {
      await setWyPlaylistSubscribed(user.userId, displayPlaylist, subscribed);
      Alert.alert(
        subscribed ? "收藏成功" : "取消收藏成功",
        `已${subscribed ? "收藏" : "取消收藏"}「${displayPlaylist.name}」`,
      );
      if (!subscribed) onBack();
    } catch (err) {
      Alert.alert(
        subscribed ? "收藏失败" : "取消收藏失败",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setSubscribing(false);
    }
  };

  const handleLocateCurrentSong = () => {
    if (currentSongIndex < 0) return;
    setLocatedSongIndex(currentSongIndex);
    scrollRef.current?.scrollTo({ y: 260 + currentSongIndex * 84, animated: true });
  };

  const handleRemoveWySong = (song: MusicInfo) => {
    if (!canRemoveSongs || removingSongKey) return;
    Alert.alert("移除歌曲", `确定从「${displayPlaylist.name}」移除「${song.name}」吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: () => {
          const key = `${song.source}:${song.id}`;
          setRemovingSongKey(key);
          removeSongFromWyPlaylist(displayPlaylist.id, song)
            .catch((err) => {
              Alert.alert("移除失败", err instanceof Error ? err.message : String(err));
            })
            .finally(() => setRemovingSongKey(null));
        },
      },
    ]);
  };

  const coverUrl = displayPlaylist.coverImgUrl || displayPlaylist.picUrl;

  return (
    <ScreenScaffold>
      <ScreenScrollView innerRef={scrollRef}>
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />
        <DetailHero
          imageUrl={coverUrl}
          title={displayPlaylist.name}
          subtitle={displayPlaylist.desc}
          metadata={[
            `${songs.length || displayPlaylist.trackCount} 首歌`,
            ...(displayPlaylist.playCount && displayPlaylist.playCount > 0
              ? [`播放 ${formatPlayCount(displayPlaylist.playCount)}`]
              : []),
          ]}
          actions={!loading && !error && detailActions.show ? (
            <>
          <Pressable style={[styles.playAllButton, { backgroundColor: palette.primary }]} onPress={handlePlayAll}>
            <Text style={[styles.playAllText, { color: palette.primaryText }]}>{detailActions.playAllLabel}</Text>
            <Text style={[styles.playAllCount, { color: palette.primaryText }]}>({songs.length})</Text>
          </Pressable>
          <Pressable style={[styles.shuffleButton, { backgroundColor: palette.surface }]} onPress={handleShufflePlay}>
            <Text style={[styles.shuffleText, { color: palette.primary }]}>{detailActions.shuffleLabel}</Text>
          </Pressable>
          <Pressable
            style={[styles.locateButton, { backgroundColor: palette.surface }, currentSongIndex < 0 && styles.locateButtonDisabled]}
            onPress={handleLocateCurrentSong}
            disabled={currentSongIndex < 0}
          >
            <Text style={[styles.locateText, { color: currentSongIndex < 0 ? palette.textMuted : palette.primary }]}>定位当前播放</Text>
          </Pressable>
          {detailActions.showRefresh && (
            <Pressable
              style={[styles.refreshButton, { backgroundColor: palette.surface }, (refreshing || loading) && styles.refreshButtonDisabled]}
              onPress={handleRefresh}
              disabled={refreshing || loading}
            >
              <Text style={[styles.refreshText, { color: (refreshing || loading) ? palette.textMuted : palette.primary }]}>
                {detailActions.refreshLabel}
              </Text>
            </Pressable>
          )}
          {canSubscribeWyPlaylist && (
            <Pressable
              style={[styles.subscribeButton, { backgroundColor: palette.surface, borderColor: subscribing ? palette.border : palette.primary }, subscribing && styles.subscribeButtonDisabled]}
              onPress={() => void handleSetWyPlaylistSubscribed(true)}
              disabled={subscribing}
            >
              <Text style={[styles.subscribeText, { color: subscribing ? palette.textMuted : palette.primary }]}>
                {subscribing ? "处理中..." : "收藏到网易云"}
              </Text>
            </Pressable>
          )}
          {canUnsubscribeWyPlaylist && (
            <Pressable
              style={[styles.subscribeButton, { backgroundColor: palette.surface, borderColor: subscribing ? palette.border : palette.primary }, subscribing && styles.subscribeButtonDisabled]}
              onPress={() => void handleSetWyPlaylistSubscribed(false)}
              disabled={subscribing}
            >
              <Text style={[styles.subscribeText, { color: subscribing ? palette.textMuted : palette.primary }]}>
                {subscribing ? "处理中..." : "取消收藏"}
              </Text>
            </Pressable>
          )}
          {importablePlaylist && (
            <Pressable
              style={[
                styles.importButton,
                { backgroundColor: palette.surface, borderColor: (importStatus.imported || songs.length === 0) ? palette.border : palette.primary },
                (importStatus.imported || songs.length === 0) && styles.importButtonDisabled,
              ]}
              onPress={handleImportPlaylist}
              disabled={importing || importStatus.imported || songs.length === 0}
            >
              <Text style={[
                styles.importText,
                { color: (importStatus.imported || songs.length === 0) ? palette.textMuted : palette.primary },
              ]}>
              {importing ? "导入中..." : importStatus.label}
              </Text>
            </Pressable>
          )}
            </>
          ) : undefined}
        />

        {loading ? (
          <LoadingState label="正在加载歌单" />
        ) : error ? (
          <ErrorState
            message={error}
            onRetry={() => void fetchPlaylistDetail(playlist.id, playlist.source, playlist)}
          />
        ) : (
          <View style={styles.section}>
            <SectionHeader title="歌曲" description={`${songs.length} 首`} />
            {songs.length > 0 ? (
              <SongList
                songs={songs}
                onPlay={handlePlay}
                emptyText="暂无歌曲"
                onDelete={canRemoveSongs && !removingSongKey ? (song) => handleRemoveWySong(song) : undefined}
                highlightedIndex={locatedSongIndex}
                hideSourceTag
              />
            ) : (
              <EmptyState title="暂无歌曲" />
            )}
          </View>
        )}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

function formatPlayCount(count: number): string {
  if (count >= 100000000) {
    return `${(count / 100000000).toFixed(1)}亿次`;
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万次`;
  }
  return `${count}次`;
}

const styles = StyleSheet.create({
  playAllButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    borderRadius: radius.pill,
    gap: 8,
    flexGrow: 1,
  },
  playAllText: {
    fontSize: typography.title,
    fontWeight: "600",
  },
  playAllCount: {
    fontSize: typography.body,
    opacity: 0.7,
  },
  shuffleButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: radius.pill,
  },
  shuffleText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  refreshButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: radius.pill,
  },
  refreshButtonDisabled: {
    opacity: 0.7,
  },
  refreshText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  locateButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: radius.pill,
  },
  locateButtonDisabled: {
    opacity: 0.7,
  },
  locateText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  subscribeButton: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: radius.pill,
  },
  subscribeButtonDisabled: {
    opacity: 0.7,
  },
  subscribeText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  importButton: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: radius.pill,
  },
  importButtonDisabled: {
    opacity: 0.7,
  },
  importText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  section: {
    gap: 12,
  },
});
