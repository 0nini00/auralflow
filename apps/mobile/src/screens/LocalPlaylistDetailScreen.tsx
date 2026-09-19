import React, { useCallback, useMemo, useRef, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import type { MusicInfo } from "@lx/core";
import {
  Download,
  FolderPlus,
  ListMusic,
  ListStart,
  SquareCheckBig,
  Trash2,
} from "lucide-react-native";

import { ActionButton } from "@/components/ActionButton";
import { SongList } from "@/components/SongList";
import { DetailHero } from "@/components/DetailHero";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import { BatchActionBar, batchToolbarPositionStyle } from "@/components/BatchActionBar";
import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { DownloadQualityModal } from "@/components/DownloadQualityModal";
import { Touchable } from "@/components/Touchable";

import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { buildPlaylistDetailActions, findPlaylistCurrentSongIndex } from "@/services/playlistDetailActions";
import { resolveLocalPlaylistCover } from "@/services/localPlaylistModel";
import { usePlaylistStore } from "@/stores/playlistStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useDownloadStore, type DownloadQuality, type DownloadSongResult } from "@/stores/downloadStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";
import { layout, spacing, typography } from "@/theme/tokens";

interface LocalPlaylistDetailScreenProps {
  playlistId: string;
  onBack: () => void;
  onNavigateToPlayer: () => void;
  onOpenPlaylist?: (playlistId: string) => void;
}

export function LocalPlaylistDetailScreen({
  playlistId,
  onBack,
  onNavigateToPlayer: _onNavigateToPlayer,
  onOpenPlaylist: _onOpenPlaylist,
}: LocalPlaylistDetailScreenProps) {
  const listRef = useRef<FlatList<MusicInfo> | null>(null);
  const mountedRef = useRef(true);
  const batchRunningRef = useRef(false);

  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const playlist = usePlaylistStore((state) =>
    state.localPlaylists.find((item) => item.id === playlistId),
  );
  const deleteLocalPlaylist = usePlaylistStore((state) => state.deleteLocalPlaylist);
  const removeSongFromLocalPlaylist = usePlaylistStore((state) => state.removeSongFromLocalPlaylist);
  const removeSongsFromLocalPlaylist = usePlaylistStore((state) => state.removeSongsFromLocalPlaylist);
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const downloadSong = useDownloadStore((state) => state.downloadSong);

  const [locatedSongIndex, setLocatedSongIndex] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // 批量选择状态
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [downloadVisible, setDownloadVisible] = useState(false);
  const [pendingQuality, setPendingQuality] = useState<DownloadQuality | null>(null);
  const [batchDownloadProgress, setBatchDownloadProgress] = useState<{ processed: number; total: number } | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const songs = playlist?.songs ?? [];
  const songKey = useCallback((song: MusicInfo) => `${song.source}:${song.id}`, []);

  const selectedSongs = useMemo(() => {
    if (selectedKeys.size === 0) return [];
    return songs.filter((song) => selectedKeys.has(songKey(song)));
  }, [songs, selectedKeys, songKey]);

  const allSelected = songs.length > 0 && selectedKeys.size === songs.length;

  const toggleSelectSong = useCallback((song: MusicInfo) => {
    const key = songKey(song);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [songKey]);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(songs.map(songKey)));
    }
  }, [allSelected, songs, songKey]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }, []);

  const detailActions = buildPlaylistDetailActions(songs.length);
  const currentSongIndex = playlist ? findPlaylistCurrentSongIndex(songs, currentSong) : -1;

  if (!playlist) {
    return (
      <ScreenScaffold>
        <View style={styles.missingState}>
          <EmptyState
            icon={ListMusic}
            title="本地歌单不存在"
            description="歌单可能已被删除，返回曲库查看其他歌单。"
          />
        </View>
      </ScreenScaffold>
    );
  }

  // 封面智能解析：无显式封面时自动回退取第一首歌曲的封面
  const coverUrl = resolveLocalPlaylistCover(playlist);

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  };

  const handlePlay = async (_song: MusicInfo, index: number) => {
    if (selectionMode) {
      toggleSelectSong(songs[index]!);
      return;
    }
    await runPlayback(() => playQueue(songs, index));
  };

  const handlePlayAll = async () => {
    if (songs.length === 0) return;
    await runPlayback(() => playQueue(songs, 0));
  };

  const handleLocateCurrentSong = () => {
    if (currentSongIndex < 0) return;
    setLocatedSongIndex(currentSongIndex);
    listRef.current?.scrollToIndex({ index: currentSongIndex, animated: true, viewPosition: 0 });
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
            .catch((error) =>
              Alert.alert("删除失败", error instanceof Error ? error.message : String(error)),
            );
        },
      },
    ]);
  };

  const handleRemoveSong = (song: MusicInfo) => {
    void removeSongFromLocalPlaylist(playlist.id, song).catch((error) => {
      Alert.alert("移除失败", error instanceof Error ? error.message : String(error));
    });
  };

  // 批量操作处理
  const handleBatchPlayNext = () => {
    if (selectedSongs.length === 0) return;
    selectedSongs.slice().reverse().forEach((song) => playNextInQueue(song));
    Alert.alert("已设置下一首", `已将 ${selectedSongs.length} 首歌曲设为下一首播放`);
    exitSelectionMode();
  };

  const handleBatchRemove = () => {
    if (selectedSongs.length === 0) return;
    Alert.alert(
      "移除歌曲",
      `确定从歌单「${playlist.name}」中移除选中的 ${selectedSongs.length} 首歌曲吗？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "移除",
          style: "destructive",
          onPress: () => {
            void removeSongsFromLocalPlaylist(playlist.id, selectedSongs)
              .then(() => {
                exitSelectionMode();
              })
              .catch((error) => {
                Alert.alert("移除失败", error instanceof Error ? error.message : String(error));
              });
          },
        },
      ],
    );
  };

  const handleBatchDownload = async (quality: DownloadQuality) => {
    if (batchRunningRef.current || selectedSongs.length === 0) return;
    batchRunningRef.current = true;
    const targets = [...selectedSongs];
    const counts: Record<DownloadSongResult["status"], number> = {
      completed: 0,
      skipped: 0,
      inProgress: 0,
      cancelled: 0,
      failed: 0,
    };
    const failures: string[] = [];
    setPendingQuality(quality);
    setBatchDownloadProgress({ processed: 0, total: targets.length });

    try {
      for (let index = 0; index < targets.length; index += 1) {
        if (!mountedRef.current) return;
        const song = targets[index]!;
        const result = await downloadSong(song, quality);
        if (!mountedRef.current) return;
        counts[result.status] += 1;
        if (result.status === "failed") failures.push(song.name);
        if (mountedRef.current) {
          setBatchDownloadProgress({ processed: index + 1, total: targets.length });
        }
      }
    } finally {
      batchRunningRef.current = false;
    }

    if (!mountedRef.current) return;
    setPendingQuality(null);
    setBatchDownloadProgress(null);
    setDownloadVisible(false);
    exitSelectionMode();

    const summary = [
      `成功 ${counts.completed} 首`,
      `已下载跳过 ${counts.skipped} 首`,
      `下载中 ${counts.inProgress} 首`,
      `已取消 ${counts.cancelled} 首`,
      `失败 ${counts.failed} 首`,
    ];
    if (failures.length > 0) {
      const preview = failures.slice(0, 5).join("、");
      const suffix = failures.length > 5 ? ` 等 ${failures.length} 首` : "";
      summary.push(`失败歌曲：${preview}${suffix}`);
    }
    Alert.alert("批量下载结果", summary.join("\n"));
  };

  return (
    <ScreenScaffold>
      <SongList
        virtualized
        listRef={listRef}
        songs={songs}
        onPlay={handlePlay}
        onDelete={(song) => handleRemoveSong(song)}
        highlightedIndex={locatedSongIndex}
        hideSourceTag
        selectionMode={selectionMode}
        selectedKeys={selectedKeys}
        onToggleSelection={toggleSelectSong}
        contentContainerStyle={selectionMode ? styles.selectionScrollContent : styles.listContent}
        ListHeaderComponent={
          <>
            <PlaybackErrorState
              message={playbackError}
              onDismiss={() => setPlaybackError(null)}
            />
            <DetailHero
              actionsFullBleed
              imageUrl={coverUrl}
              title={playlist.name}
              subtitle={playlist.description}
              metadata={[`${songs.length} 首歌曲`]}
              actions={
                <View style={styles.heroActions}>
                  <ActionButton
                    small
                    grow
                    variant="primary"
                    label={detailActions.playAllLabel}
                    onPress={() => void handlePlayAll()}
                  />
                  <ActionButton
                    small
                    grow
                    variant="primary"
                    label="定位"
                    disabled={currentSongIndex < 0}
                    onPress={handleLocateCurrentSong}
                  />
                  <ActionButton
                    small
                    grow
                    variant="danger"
                    label="删除"
                    onPress={handleDeletePlaylist}
                  />
                </View>
              }
            />

            <View style={styles.songSection}>
              <SectionHeader
                title="歌曲"
                description={`${songs.length} 首`}
                action={
                  songs.length > 0 && !selectionMode ? (
                    <Touchable
                      style={[
                        styles.selectButton,
                        {
                          backgroundColor: withAlpha(palette.primary, 0.08),
                          borderColor: withAlpha(palette.primary, 0.2),
                        },
                      ]}
                      onPress={() => {
                        hapticLight();
                        setSelectionMode(true);
                      }}
                      activeScale={0.96}
                      accessibilityRole="button"
                      accessibilityLabel="批量选择歌曲"
                    >
                      <SquareCheckBig size={14} color={palette.primary} />
                      <Text style={[styles.selectButtonText, { color: palette.primary }]}>多选</Text>
                    </Touchable>
                  ) : undefined
                }
              />
            </View>
          </>
        }
        ListFooterComponent={
          songs.length > 0 ? null : (
            <EmptyState
              title="还没有歌曲"
              description="点击添加歌曲，导入本地音乐。"
            />
          )
        }
      />

      {selectionMode ? (
        <BatchActionBar
          style={batchToolbarPositionStyle()}
          headerText={
            batchDownloadProgress
              ? `已处理 ${batchDownloadProgress.processed}/${batchDownloadProgress.total}`
              : `已选 ${selectedSongs.length} 首`
          }
          selectAllLabel="全选"
          allSelected={allSelected}
          onToggleSelectAll={toggleSelectAll}
          onExit={exitSelectionMode}
          busy={batchRunningRef.current}
          actions={[
            {
              key: "next",
              label: "下一首",
              icon: <ListStart />,
              disabled: selectedSongs.length === 0,
              onPress: handleBatchPlayNext,
            },
            {
              key: "playlist",
              label: "收藏",
              icon: <FolderPlus />,
              disabled: selectedSongs.length === 0,
              onPress: () => setAddToPlaylistVisible(true),
            },
            {
              key: "remove",
              label: "移除",
              icon: <Trash2 />,
              disabled: selectedSongs.length === 0,
              onPress: handleBatchRemove,
            },
            {
              key: "download",
              label: "下载",
              icon: <Download />,
              disabled: selectedSongs.length === 0,
              onPress: () => setDownloadVisible(true),
            },
          ]}
        />
      ) : null}

      {/* 批量收藏到其他歌单弹窗 */}
      <AddToLocalPlaylistModal
        visible={addToPlaylistVisible}
        songs={selectedSongs}
        onClose={() => setAddToPlaylistVisible(false)}
      />

      {/* 批量下载音质弹窗 */}
      <DownloadQualityModal
        visible={downloadVisible}
        song={null}
        summaryText={`已选择 ${selectedSongs.length} 首歌曲`}
        progressText={
          batchDownloadProgress
            ? `已处理 ${batchDownloadProgress.processed}/${batchDownloadProgress.total}`
            : null
        }
        pendingQuality={pendingQuality}
        onClose={() => setDownloadVisible(false)}
        onDownload={handleBatchDownload}
      />
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  missingState: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  heroActions: {
    flexGrow: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  songSection: {
    gap: spacing.s,
  },
  selectButton: {
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
  },
  selectButtonText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  selectionScrollContent: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xs,
    paddingBottom: 160,
  },
  listContent: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xs,
    paddingBottom: spacing.l,
  },
});
