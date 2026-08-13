import React, { useEffect, useMemo, useRef, useState } from "react";
import { layout, radius, spacing, typography } from "@/theme/tokens";
import {
  Alert,
  type ScrollView as ScrollViewType,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";
import type { MusicInfo } from "@lx/core";
import { Download, ListEnd, ListPlus, ListStart, Music2, SquareCheckBig, X } from "lucide-react-native";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { useAccountStore } from "@/stores/accountStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { usePlayerStore } from "@/stores/playerStore";
import {
  useDownloadStore,
  type DownloadQuality,
  type DownloadSongResult,
} from "@/stores/downloadStore";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import {
  buildPlaylistDetailActions,
  canRemoveSongsFromPlaylistDetail,
} from "@/services/playlistDetailActions";
import { ActionButton } from "@/components/ActionButton";
import { BatchActionBar, batchToolbarPositionStyle } from "@/components/BatchActionBar";
import { SongList } from "@/components/SongList";
import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { DownloadQualityModal } from "@/components/DownloadQualityModal";
import { DetailHero } from "@/components/DetailHero";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";

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
  const mountedRef = useRef(true);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const [subscribing, setSubscribing] = useState(false);
  const [removingSongKey, setRemovingSongKey] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [addToLocalVisible, setAddToLocalVisible] = useState(false);
  const [downloadModalVisible, setDownloadModalVisible] = useState(false);
  const [batchDownloadQuality, setBatchDownloadQuality] = useState<DownloadQuality | null>(null);
  const [batchDownloadProgress, setBatchDownloadProgress] = useState<{ processed: number; total: number } | null>(null);
  const user = useAccountStore((state) => state.user);
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const currentPlaylistSongs = usePlaylistStore((state) => state.currentPlaylistSongs);
  const likedPlaylist = usePlaylistStore((state) => state.likedPlaylist);
  const likedSongs = usePlaylistStore((state) => state.likedSongs);
  const loading = usePlaylistStore((state) => state.loading);
  const error = usePlaylistStore((state) => state.error);
  const removeSongFromWyPlaylist = usePlaylistStore((state) => state.removeSongFromWyPlaylist);
  const setWyPlaylistSubscribed = usePlaylistStore((state) => state.setWyPlaylistSubscribed);
  const fetchPlaylistDetail = usePlaylistStore(
    (state) => state.fetchPlaylistDetail
  );
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue);
  const downloadSong = useDownloadStore((state) => state.downloadSong);

  const isLikedPlaylist = likedPlaylist?.id === playlist.id;
  const songs = isLikedPlaylist ? likedSongs : currentPlaylistSongs;
  const displayPlaylist = isLikedPlaylist && likedPlaylist ? likedPlaylist : playlist;
  const selectedSongs = useMemo(
    () => songs.filter((song) => selectedKeys.has(getSongKey(song))),
    [selectedKeys, songs],
  );
  const allSelected = songs.length > 0 && selectedSongs.length === songs.length;
  const batchBusy = batchDownloadQuality !== null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    fetchPlaylistDetail(playlist.id, playlist.source, playlist);
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }, [playlist, fetchPlaylistDetail]);

  useEffect(() => {
    const availableKeys = new Set(songs.map(getSongKey));
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => availableKeys.has(key)));
      if (next.size !== current.size) return next;
      return [...next].every((key) => current.has(key)) ? current : next;
    });
  }, [songs]);

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
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
  });
  const canSubscribeWyPlaylist = displayPlaylist.source === "wy" && displayPlaylist.subscribed !== true;
  const canUnsubscribeWyPlaylist = displayPlaylist.source === "wy" && displayPlaylist.subscribed === true;
  const canRemoveSongs = canRemoveSongsFromPlaylistDetail({
    source: displayPlaylist.source,
    subscribed: displayPlaylist.subscribed,
  });

  const handleSetWyPlaylistSubscribed = async (subscribed: boolean) => {
    if (subscribing) return;
    if (!isLoggedIn || !user) {
      Alert.alert("需要登录", "请在 设置 → 账号与服务 登录网易云账号");
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

  const toggleSelection = (song: MusicInfo) => {
    const key = getSongKey(song);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const enterSelectionMode = (song: MusicInfo) => {
    setSelectionMode(true);
    setSelectedKeys(new Set([getSongKey(song)]));
  };

  const exitSelectionMode = () => {
    if (batchBusy) return;
    setSelectionMode(false);
    setSelectedKeys(new Set());
    setAddToLocalVisible(false);
    setDownloadModalVisible(false);
  };

  const toggleSelectAll = () => {
    setSelectedKeys(allSelected ? new Set() : new Set(songs.map(getSongKey)));
  };

  const handleBatchAddToQueue = () => {
    if (selectedSongs.length === 0) return;
    selectedSongs.forEach(addToQueue);
    Alert.alert("已加入队列", `已添加 ${selectedSongs.length} 首歌曲`);
  };

  const handleBatchPlayNext = () => {
    if (selectedSongs.length === 0) return;
    selectedSongs.forEach(playNextInQueue);
    Alert.alert("已添加", `${selectedSongs.length} 首歌曲将按歌单顺序播放`);
  };

  const handleBatchDownload = async (quality: DownloadQuality) => {
    if (batchBusy || selectedSongs.length === 0) return;
    const targets = [...selectedSongs];
    const counts: Record<DownloadSongResult["status"], number> = {
      completed: 0,
      skipped: 0,
      inProgress: 0,
      cancelled: 0,
      failed: 0,
    };
    const failures: string[] = [];
    setBatchDownloadQuality(quality);
    setBatchDownloadProgress({ processed: 0, total: targets.length });

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

    if (!mountedRef.current) return;
    setBatchDownloadQuality(null);
    setBatchDownloadProgress(null);
    setDownloadModalVisible(false);
    // 批量下载结束：直接重置选择状态退出选择模式（exitSelectionMode 依赖 batchBusy 闭包旧值会空转）
    setSelectionMode(false);
    setSelectedKeys(new Set());
    setAddToLocalVisible(false);
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
      <ScreenScrollView
        innerRef={scrollRef}
        contentContainerStyle={selectionMode ? styles.selectionScrollContent : undefined}
      >
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />
        <DetailHero
          compact
          imageUrl={coverUrl}
          title={displayPlaylist.name}
          subtitle={displayPlaylist.desc}
          coverBadge={
            displayPlaylist.playCount && displayPlaylist.playCount > 0
              ? formatPlayCount(displayPlaylist.playCount)
              : undefined
          }
          actions={!loading && !error && detailActions.show ? (
            <View style={styles.heroActions}>
          <ActionButton
            shrink
            small
            variant="primary"
            label={detailActions.playAllLabel}
            count={`(${songs.length})`}
            onPress={() => void handlePlayAll()}
          />
          {canSubscribeWyPlaylist && (
            <ActionButton
              shrink
              small
              variant="primary"
              label={subscribing ? "处理中…" : "收藏"}
              loading={subscribing}
              onPress={() => void handleSetWyPlaylistSubscribed(true)}
            />
          )}
          {canUnsubscribeWyPlaylist && (
            <ActionButton
              shrink
              small
              variant="primary"
              label={subscribing ? "处理中…" : "取消收藏"}
              loading={subscribing}
              onPress={() => void handleSetWyPlaylistSubscribed(false)}
            />
          )}
          {songs.length > 0 && (
            <ActionButton
              shrink
              small
              variant="secondary"
              label="下载全部"
              disabled={batchBusy}
              onPress={() => {
                // 全选后走已有的批量下载流程（选择模式 → 选音质 → 逐首入队）
                setSelectedKeys(new Set(songs.map(getSongKey)));
                setDownloadModalVisible(true);
              }}
            />
          )}
            </View>
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
            <SectionHeader
              title="歌曲"
              description={`${songs.length} 首`}
              action={songs.length > 0 && !selectionMode ? (
                <Pressable
                  style={[styles.selectButton, { backgroundColor: palette.surface }]}
                  onPress={() => setSelectionMode(true)}
                >
                  <SquareCheckBig size={17} color={palette.primary} />
                  <Text style={[styles.selectButtonText, { color: palette.primary }]}>选择</Text>
                </Pressable>
              ) : undefined}
            />
            {songs.length > 0 ? (
              <SongList
                songs={songs}
                onPlay={handlePlay}
                emptyText="暂无歌曲"
                onDelete={canRemoveSongs && !removingSongKey ? (song) => handleRemoveWySong(song) : undefined}
                hideSourceTag
                onLongPressSong={enterSelectionMode}
                selectionMode={selectionMode}
                selectedKeys={selectedKeys}
                onToggleSelection={toggleSelection}
              />
            ) : (
              <EmptyState icon={Music2} title="暂无歌曲" description="该歌单还没有收录歌曲，去首页逛逛其他歌单吧。" />
            )}
          </View>
        )}
      </ScreenScrollView>
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
          busy={batchBusy}
          actions={[
            {
              key: "queue",
              label: "队列",
              icon: <ListPlus size={19} />,
              disabled: selectedSongs.length === 0,
              onPress: handleBatchAddToQueue,
            },
            {
              key: "next",
              label: "下一首",
              icon: <ListStart size={19} />,
              disabled: selectedSongs.length === 0,
              onPress: handleBatchPlayNext,
            },
            {
              key: "collect",
              label: "收藏",
              icon: <ListEnd size={19} />,
              disabled: selectedSongs.length === 0,
              onPress: () => setAddToLocalVisible(true),
            },
            {
              key: "download",
              label: "下载",
              icon: <Download size={19} />,
              disabled: selectedSongs.length === 0,
              onPress: () => setDownloadModalVisible(true),
            },
          ]}
        />
      ) : null}
      <AddToLocalPlaylistModal
        visible={addToLocalVisible}
        songs={selectedSongs}
        onClose={() => setAddToLocalVisible(false)}
      />
      <DownloadQualityModal
        visible={downloadModalVisible}
        song={null}
        summaryText={`已选择 ${selectedSongs.length} 首歌曲`}
        progressText={batchDownloadProgress ? `已处理 ${batchDownloadProgress.processed}/${batchDownloadProgress.total}` : null}
        pendingQuality={batchDownloadQuality}
        onClose={() => {
          if (!batchBusy) {
            setDownloadModalVisible(false);
            setBatchDownloadProgress(null);
          }
        }}
        onDownload={(quality) => void handleBatchDownload(quality)}
      />
    </ScreenScaffold>
  );
}

function getSongKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
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
  heroActions: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: spacing.xs,
  },
  selectButton: {
    minHeight: layout.compactControlHeight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.s,
    borderRadius: radius.md,
  },
  selectButtonText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  selectionScrollContent: {
    paddingBottom: 152,
  },
  section: {
    gap: spacing.s,
  },
});
