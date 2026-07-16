import React, { useMemo, useState } from "react";
import { radius, typography } from "@/theme/tokens";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, type ScrollView as ScrollViewType, StyleSheet, Text, TextInput, View } from "react-native";
import type { MusicInfo } from "@lx/core";

import { SongList } from "@/components/SongList";
import { DetailHero } from "@/components/DetailHero";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { buildPlaylistDetailActions, findPlaylistCurrentSongIndex, shufflePlaylistSongs } from "@/services/playlistDetailActions";
import { getContentDetailLocateScrollOffset } from "@/services/contentDetailPlaybackActions";
import { shareExportedLocalPlaylists } from "@/services/playlistTransferService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { useLocalMusicStore } from "@/stores/localMusicStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { usePlayerStore } from "@/stores/playerStore";

interface LocalPlaylistDetailScreenProps {
  playlistId: string;
  onBack: () => void;
  onNavigateToPlayer: () => void;
  onOpenPlaylist?: (playlistId: string) => void;
}

function getSongKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

export function LocalPlaylistDetailScreen({ playlistId, onBack, onNavigateToPlayer, onOpenPlaylist }: LocalPlaylistDetailScreenProps) {
  const scrollRef = React.useRef<ScrollViewType>(null);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const playlist = usePlaylistStore((state) => state.localPlaylists.find((item) => item.id === playlistId));
  const updateLocalPlaylistInfo = usePlaylistStore((state) => state.updateLocalPlaylistInfo);
  const duplicateLocalPlaylist = usePlaylistStore((state) => state.duplicateLocalPlaylist);
  const deleteLocalPlaylist = usePlaylistStore((state) => state.deleteLocalPlaylist);
  const addSongToLocalPlaylist = usePlaylistStore((state) => state.addSongToLocalPlaylist);
  const removeSongFromLocalPlaylist = usePlaylistStore((state) => state.removeSongFromLocalPlaylist);
  const localSongs = useLocalMusicStore((state) => state.localSongs);
  const localLoading = useLocalMusicStore((state) => state.loading);
  const scanMusic = useLocalMusicStore((state) => state.scanMusic);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const [renameVisible, setRenameVisible] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [locatedSongIndex, setLocatedSongIndex] = useState<number | null>(null);
  const [nameInput, setNameInput] = useState(playlist?.name ?? "");
  const [descriptionInput, setDescriptionInput] = useState(playlist?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const detailActions = buildPlaylistDetailActions(playlist?.songs.length ?? 0);
  const currentSongIndex = playlist ? findPlaylistCurrentSongIndex(playlist.songs, currentSong) : -1;

  const availableSongs = useMemo(() => {
    const existing = new Set((playlist?.songs ?? []).map(getSongKey));
    return localSongs.filter((song) => !existing.has(getSongKey(song)));
  }, [localSongs, playlist?.songs]);

  if (!playlist) {
    return (
      <ScreenScaffold>
        <View style={styles.missingState}>
          <EmptyState title="本地歌单不存在" />
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
    onNavigateToPlayer();
  };

  const handlePlay = async (_song: MusicInfo, index: number) => {
    await runPlayback(() => playQueue(playlist.songs, index));
  };

  const handlePlayAll = async () => {
    if (playlist.songs.length === 0) return;
    await runPlayback(() => playQueue(playlist.songs, 0));
  };

  const handleShufflePlay = async () => {
    if (playlist.songs.length === 0) return;
    await runPlayback(() => playQueue(shufflePlaylistSongs(playlist.songs), 0));
  };

  const handleLocateCurrentSong = () => {
    if (currentSongIndex < 0) return;
    setLocatedSongIndex(currentSongIndex);
    scrollRef.current?.scrollTo({
      y: getContentDetailLocateScrollOffset(currentSongIndex),
      animated: true,
    });
  };

  const handleRename = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateLocalPlaylistInfo(playlist.id, {
        name: nameInput,
        description: descriptionInput,
      });
      setRenameVisible(false);
    } catch (error) {
      Alert.alert("编辑失败", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
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

  const handleDuplicatePlaylist = async () => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const duplicated = await duplicateLocalPlaylist(playlist.id);
      onOpenPlaylist?.(duplicated.id);
    } catch (error) {
      Alert.alert("复制失败", error instanceof Error ? error.message : String(error));
    } finally {
      setDuplicating(false);
    }
  };

  const handleExportPlaylist = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await shareExportedLocalPlaylists([playlist]);
    } catch (error) {
      Alert.alert("导出失败", error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  const handleRemoveSong = (song: MusicInfo) => {
    void removeSongFromLocalPlaylist(playlist.id, song).catch((error) => {
      Alert.alert("移除失败", error instanceof Error ? error.message : String(error));
    });
  };

  const handleAddSong = async (song: MusicInfo) => {
    try {
      await addSongToLocalPlaylist(playlist.id, song);
    } catch (error) {
      Alert.alert("添加失败", error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenAdd = async () => {
    if (localSongs.length === 0) {
      try {
        await scanMusic();
      } catch (error) {
        Alert.alert("扫描失败", error instanceof Error ? error.message : String(error));
        return;
      }
    }
    setAddVisible(true);
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView innerRef={scrollRef}>
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />
        <DetailHero
          imageUrl={coverUrl}
          title={playlist.name}
          subtitle={playlist.description}
          metadata={[`${playlist.songs.length} 首歌曲`]}
          actions={
            <>
        {detailActions.show ? (
          <>
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
          </>
        ) : null}
        <Pressable style={[styles.secondaryButton, { backgroundColor: palette.surface }]} onPress={handleOpenAdd}>
          <Text style={[styles.secondaryButtonText, { color: palette.primary }]}>添加歌曲</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, { backgroundColor: palette.surface }]}
          onPress={() => {
            setNameInput(playlist.name);
            setDescriptionInput(playlist.description ?? "");
            setRenameVisible(true);
          }}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.primary }]}>编辑信息</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, { backgroundColor: palette.surface }]}
          onPress={handleDuplicatePlaylist}
          disabled={duplicating}
        >
          {duplicating ? (
            <ActivityIndicator color={palette.primary} size="small" />
          ) : (
            <Text style={[styles.secondaryButtonText, { color: palette.primary }]}>复制歌单</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, { backgroundColor: palette.surface }]}
          onPress={handleExportPlaylist}
          disabled={exporting}
        >
          {exporting ? (
            <ActivityIndicator color={palette.primary} size="small" />
          ) : (
            <Text style={[styles.secondaryButtonText, { color: palette.primary }]}>导出歌单</Text>
          )}
        </Pressable>
        <Pressable style={[styles.dangerButton, { backgroundColor: palette.dangerSurface }]} onPress={handleDeletePlaylist}>
          <Text style={[styles.dangerButtonText, { color: palette.danger }]}>删除歌单</Text>
        </Pressable>
            </>
          }
        />

        <View style={styles.songSection}>
          <SectionHeader title="歌曲" description={`${playlist.songs.length} 首`} />
          {playlist.songs.length > 0 ? (
            <SongList
              songs={playlist.songs}
              onPlay={handlePlay}
              onDelete={(song) => handleRemoveSong(song)}
              emptyText="还没有歌曲，点击添加歌曲导入本地音乐"
              highlightedIndex={locatedSongIndex}
              hideSourceTag
            />
          ) : (
            <EmptyState
              title="还没有歌曲"
              description="点击添加歌曲导入本地音乐。"
            />
          )}
        </View>

      <Modal visible={renameVisible} animationType="slide" transparent onRequestClose={() => setRenameVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.surface }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>编辑歌单信息</Text>
            <TextInput
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="输入歌单名称"
              placeholderTextColor={palette.textMuted}
              style={[styles.input, { borderColor: palette.border, color: palette.text }]}
            />
            <TextInput
              value={descriptionInput}
              onChangeText={setDescriptionInput}
              placeholder="描述（可选）"
              placeholderTextColor={palette.textMuted}
              multiline
              style={[styles.input, styles.textArea, { borderColor: palette.border, color: palette.text }]}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalButton} onPress={() => setRenameVisible(false)} disabled={saving}>
                <Text style={[styles.modalButtonText, { color: palette.textMuted }]}>取消</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, { backgroundColor: palette.primary }]} onPress={handleRename} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color={palette.primaryText} size="small" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: palette.primaryText }]}>保存</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={addVisible} animationType="slide" onRequestClose={() => setAddVisible(false)}>
        <ScrollView contentContainerStyle={[styles.modalScrollContent, { backgroundColor: palette.background }]}>
          <View style={styles.modalHeaderRow}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>添加本地歌曲</Text>
            <Pressable onPress={() => setAddVisible(false)}>
              <Text style={[styles.closeText, { color: palette.primary }]}>关闭</Text>
            </Pressable>
          </View>
          {localLoading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator color={palette.primary} size="large" />
              <Text style={[styles.emptyText, { color: palette.textMuted }]}>正在扫描本地音乐</Text>
            </View>
          ) : availableSongs.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: palette.textMuted }]}>没有可添加的本地歌曲</Text>
            </View>
          ) : (
            availableSongs.map((song) => (
              <Pressable
                key={getSongKey(song)}
                style={[styles.addSongItem, { backgroundColor: palette.surface }]}
                onPress={() => void handleAddSong(song)}
              >
                <View style={styles.addSongInfo}>
                  <Text style={[styles.addSongName, { color: palette.text }]} numberOfLines={1}>{song.name}</Text>
                  <Text style={[styles.addSongMeta, { color: palette.textMuted }]} numberOfLines={1}>{song.singer}</Text>
                </View>
                <Text style={[styles.addSongAction, { color: palette.primary }]}>添加</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </Modal>
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  modalScrollContent: {
    padding: 20,
  },
  missingState: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
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
  dangerButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  dangerButtonText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  songSection: {
    gap: 12,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: "center",
    gap: 12,
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
    padding: 20,
    gap: 16,
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
    gap: 12,
  },
  modalButton: {
    minWidth: 80,
    minHeight: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  modalButtonText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  closeText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  addSongItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: radius.sm,
    marginBottom: 8,
    gap: 12,
  },
  addSongInfo: {
    flex: 1,
    gap: 4,
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
