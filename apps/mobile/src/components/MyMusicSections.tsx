import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MusicInfo } from "@lx/core";

import { DownloadList } from "@/components/DownloadList";
import { HistorySection } from "@/components/HistorySection";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import { SongList } from "@/components/SongList";
import {
  buildLibrarySongActions,
  buildLibrarySongDeleteRequest,
  shuffleLibrarySongs,
} from "@/services/librarySongActions";
import { buildLibraryLocalMusicActions } from "@/services/libraryLocalMusicActions";
import { pickImageFromGallery } from "@/services/imagePickerService";
import { writeLocalMusicCover, writeLocalMusicLyrics } from "@/services/localMusicService";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { useAccountStore } from "@/stores/accountStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useLocalMusicStore } from "@/stores/localMusicStore";
import { useDownloadStore } from "@/stores/downloadStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

export function useMyMusicPalette() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  return useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );
}

/* ------------------------------------------------------------------ */
/* 本地音乐                                                             */
/* ------------------------------------------------------------------ */

export function MyLocalMusicSection({ onNavigateToPlayer }: { onNavigateToPlayer: () => void }) {
  const palette = useMyMusicPalette();
  const { checkStatus } = useAccountStore();
  const localSongs = useLocalMusicStore((state) => state.localSongs);
  const scanMusic = useLocalMusicStore((state) => state.scanMusic);
  const importLocalFiles = useLocalMusicStore((state) => state.importLocalFiles);
  const removeLocalSong = useLocalMusicStore((state) => state.removeLocalSong);
  const updateLocalSongMetadata = useLocalMusicStore((state) => state.updateLocalSongMetadata);
  const loading = useLocalMusicStore((state) => state.loading);
  const error = useLocalMusicStore((state) => state.error);

  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [editingSong, setEditingSong] = useState<MusicInfo | null>(null);
  const [songName, setSongName] = useState("");
  const [songSinger, setSongSinger] = useState("");
  const [songAlbumName, setSongAlbumName] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [coverUri, setCoverUri] = useState("");
  const [songLyrics, setSongLyrics] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const localMusicActions = buildLibraryLocalMusicActions({
    localSongCount: localSongs.length,
    loading,
  });

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  };

  const handlePlay = async (_song: MusicInfo, index: number) => {
    await runPlayback(() => playQueue(localSongs, index));
  };

  const handlePlayAll = async () => {
    if (localSongs.length === 0) return;
    await runPlayback(() => playQueue(localSongs, 0));
  };

  const handleScan = async () => {
    try {
      const previousCount = localSongs.length;
      await scanMusic();
      const next = useLocalMusicStore.getState().localSongs;
      if (next.length === 0) {
        Alert.alert("提示", "未找到本地音乐文件");
      } else if (previousCount === 0) {
        Alert.alert("提示", `找到 ${next.length} 首本地音乐`);
      } else {
        Alert.alert("刷新完成", `当前共 ${next.length} 首本地歌曲`);
      }
    } catch (scanError) {
      Alert.alert("扫描失败", scanError instanceof Error ? scanError.message : String(scanError));
    }
  };

  const handleImport = async () => {
    try {
      const previousCount = localSongs.length;
      const result = await importLocalFiles();
      if (result.added === 0) {
        Alert.alert("提示", previousCount === result.total ? "未选择新文件，或所选文件已在曲库中" : "未选择文件");
        return;
      }
      Alert.alert("导入完成", `新增 ${result.added} 首，当前共 ${result.total} 首本地歌曲`);
    } catch (importError) {
      Alert.alert("导入失败", importError instanceof Error ? importError.message : String(importError));
    }
  };

  const handleDelete = (song: MusicInfo) => {
    const request = buildLibrarySongDeleteRequest("local", song);
    if (request.type !== "local") return;
    Alert.alert(request.title, request.message, [
      { text: "取消", style: "cancel" },
      {
        text: request.confirmLabel,
        style: "destructive",
        onPress: () => {
          void removeLocalSong(request.song).catch((deleteError) => {
            Alert.alert("移除失败", deleteError instanceof Error ? deleteError.message : String(deleteError));
          });
        },
      },
    ]);
  };

  const handleEditOpen = (song: MusicInfo) => {
    setEditingSong(song);
    setSongName(song.name);
    setSongSinger(song.singer || "");
    setSongAlbumName(song.albumName || "");
    setCoverUrl(song.picUrl || song.img || "");
    setCoverUri("");
    setSongLyrics(song.localLyrics || "");
  };

  const closeEditor = () => {
    setEditingSong(null);
  };

  const handlePickCover = async () => {
    try {
      const uri = await pickImageFromGallery();
      if (uri) {
        setCoverUri(uri);
        setCoverUrl("");
      }
    } catch (pickError) {
      Alert.alert("选择封面失败", pickError instanceof Error ? pickError.message : String(pickError));
    }
  };

  const handleSave = async () => {
    if (!editingSong || saving) return;
    setSaving(true);
    try {
      const mediaId = String(editingSong.id);
      const coverValue = coverUri || coverUrl;
      await updateLocalSongMetadata(
        { id: editingSong.id, source: editingSong.source },
        {
          name: songName,
          singer: songSinger,
          albumName: songAlbumName,
          coverUrl: coverValue,
          localLyrics: songLyrics,
        },
      );
      if (coverUri) {
        await writeLocalMusicCover(mediaId, coverUri);
      }
      await writeLocalMusicLyrics(mediaId, songLyrics);
      closeEditor();
    } catch (saveError) {
      Alert.alert("编辑失败", saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.sectionContent}>
        <PlaybackErrorState message={playbackError} onDismiss={() => setPlaybackError(null)} />
        <SectionHeader
          title="本地音乐"
          description={
            loading
              ? "正在扫描本地音乐"
              : localSongs.length === 0
                ? "点击下方按钮扫描或添加本地音乐"
                : `${localSongs.length} 首本地歌曲`
          }
          action={
            <View style={styles.songActionButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="播放全部本地音乐"
                onPress={() => void handlePlayAll()}
                style={[styles.songActionButton, { backgroundColor: palette.primary }]}
              >
                <Text style={[styles.songActionButtonText, { color: palette.primaryText }]}>播放全部</Text>
              </Pressable>
              <View style={styles.localActionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={localMusicActions.scanAccessibilityLabel}
                  accessibilityHint={localMusicActions.scanHint}
                  onPress={() => void handleScan()}
                  disabled={localMusicActions.disabled}
                  style={[styles.scanButton, { backgroundColor: palette.surface }]}
                >
                  {loading ? (
                    <ActivityIndicator color={palette.primary} size="small" />
                  ) : (
                    <Text style={[styles.scanButtonText, { color: palette.primary }]}>
                      {localMusicActions.scanLabel}
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={localMusicActions.importAccessibilityLabel}
                  accessibilityHint={localMusicActions.importHint}
                  onPress={() => void handleImport()}
                  disabled={localMusicActions.disabled}
                  style={[styles.scanButton, { backgroundColor: palette.surface }]}
                >
                  <Text style={[styles.scanButtonText, { color: palette.primary }]}>
                    {localMusicActions.importLabel}
                  </Text>
                </Pressable>
              </View>
            </View>
          }
          style={styles.section}
        />
        {error ? <ErrorState message={error} /> : null}
        {loading && localSongs.length === 0 ? (
          <LoadingState label="正在扫描本地音乐" />
        ) : (
          <SongList
            songs={localSongs}
            onPlay={handlePlay}
            onEdit={handleEditOpen}
            onDelete={handleDelete}
            emptyText="还没有扫描本地音乐"
          />
        )}
      </ScreenScrollView>

      <Modal visible={Boolean(editingSong)} animationType="slide" transparent onRequestClose={closeEditor}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[styles.modalCard, { backgroundColor: palette.surface }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>编辑本地音乐</Text>
            <TextInput
              value={songName}
              onChangeText={setSongName}
              placeholder="歌曲标题"
              placeholderTextColor={palette.textMuted}
              style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
            />
            <TextInput
              value={songSinger}
              onChangeText={setSongSinger}
              placeholder="艺术家"
              placeholderTextColor={palette.textMuted}
              style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
            />
            <TextInput
              value={songAlbumName}
              onChangeText={setSongAlbumName}
              placeholder="专辑"
              placeholderTextColor={palette.textMuted}
              style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
            />
            <TextInput
              value={coverUrl}
              onChangeText={(text) => {
                setCoverUrl(text);
                setCoverUri("");
              }}
              placeholder="封面 URL（可选，不写入文件）"
              placeholderTextColor={palette.textMuted}
              style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
            />
            <Pressable
              style={[styles.createInput, styles.coverPickerButton, { borderColor: palette.border }]}
              onPress={() => void handlePickCover()}
            >
              <Text style={[styles.coverPickerText, { color: palette.primary }]}>
                {coverUri ? "已选择本地图片（将写入文件）" : "从相册选择封面图片"}
              </Text>
            </Pressable>
            <TextInput
              value={songLyrics}
              onChangeText={setSongLyrics}
              placeholder="LRC 或纯文本歌词，留空清除"
              placeholderTextColor={palette.textMuted}
              multiline
              style={[styles.createInput, styles.resultInput, { borderColor: palette.border, color: palette.text }]}
            />
            <Text style={[styles.modalHint, { color: palette.textMuted }]}>
              标题、歌手、专辑会更新到系统媒体库；封面与歌词会写入音频文件（可能需授权修改媒体文件），留空歌词可清除内嵌歌词。
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalButton} onPress={closeEditor} disabled={saving}>
                <Text style={[styles.modalButtonText, { color: palette.textMuted }]}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, { backgroundColor: palette.primary }]}
                onPress={() => void handleSave()}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={palette.primaryText} size="small" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: palette.primaryText }]}>保存</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenScaffold>
  );
}

/* ------------------------------------------------------------------ */
/* 播放历史                                                             */
/* ------------------------------------------------------------------ */

export function MyHistorySection({ onNavigateToPlayer }: { onNavigateToPlayer: () => void }) {
  const palette = useMyMusicPalette();
  const entries = useHistoryStore((state) => state.entries);
  const history = useHistoryStore((state) => state.history);
  const clearHistory = useHistoryStore((state) => state.clearHistory);
  const removeFromHistory = useHistoryStore((state) => state.removeFromHistory);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const songActions = buildLibrarySongActions("history", history.length);

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  };

  // 分组列表内播放：传入的是组内歌曲与组内序号。
  const handlePlayGroup = async (songs: MusicInfo[], index: number) => {
    await runPlayback(() => playQueue(songs, index));
  };

  const handlePlayAll = async () => {
    if (history.length === 0) return;
    await runPlayback(() => playQueue(history, 0));
  };

  const handleShuffle = async () => {
    if (history.length === 0) return;
    await runPlayback(() => playQueue(shuffleLibrarySongs(history), 0));
  };

  const handleDelete = (song: MusicInfo) => {
    const request = buildLibrarySongDeleteRequest("history", song);
    if (request.type !== "history") return;
    void removeFromHistory(request.songId, request.source);
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.sectionContent}>
        <PlaybackErrorState message={playbackError} onDismiss={() => setPlaybackError(null)} />
        <SectionHeader
          title="播放历史"
          description={entries.length === 0 ? "还没有播放记录" : `按时间记录，共 ${history.length} 首歌曲`}
          action={
            songActions.show ? (
              <View style={styles.songActionButtons}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="播放全部历史歌曲"
                  onPress={() => void handlePlayAll()}
                  style={[styles.songActionButton, { backgroundColor: palette.primary }]}
                >
                  <Text style={[styles.songActionButtonText, { color: palette.primaryText }]}>
                    {songActions.playAllLabel}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="随机播放历史歌曲"
                  onPress={() => void handleShuffle()}
                  style={[styles.songActionButton, { backgroundColor: palette.surface }]}
                >
                  <Text style={[styles.songActionButtonText, { color: palette.primary }]}>
                    {songActions.shuffleLabel}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="清空播放历史"
                  onPress={clearHistory}
                  style={[styles.clearButton, { backgroundColor: palette.dangerSurface }]}
                >
                  <Text style={[styles.clearButtonText, { color: palette.danger }]}>清空</Text>
                </Pressable>
              </View>
            ) : undefined
          }
          style={styles.section}
        />
        <HistorySection
          entries={entries}
          onPlay={handlePlayGroup}
          onDelete={songActions.canDeleteSongs ? handleDelete : undefined}
          emptyText="播放歌曲后会自动按时间记录到这里"
        />
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

/* ------------------------------------------------------------------ */
/* 下载                                                                 */
/* ------------------------------------------------------------------ */

export function MyDownloadsSection({ onNavigateToPlayer }: { onNavigateToPlayer: () => void }) {
  const palette = useMyMusicPalette();
  const downloads = useDownloadStore((state) => state.downloads);
  const downloading = useDownloadStore((state) => state.downloading);
  const failedDownloads = useDownloadStore((state) => state.failedDownloads);
  const loadDownloads = useDownloadStore((state) => state.loadDownloads);

  useEffect(() => {
    void loadDownloads();
  }, [loadDownloads]);

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.sectionContent}>
        <SectionHeader
          title="下载管理"
          description={
            downloads.length > 0
              ? `已下载 ${downloads.length} 首，失败 ${failedDownloads.length} 个`
              : "从搜索或歌单下载后即可离线播放"
          }
          style={styles.section}
        />
        <DownloadList
          downloads={downloads}
          downloading={downloading}
          failedDownloads={failedDownloads}
          onNavigateToPlayer={onNavigateToPlayer}
        />
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

export const styles = StyleSheet.create({
  sectionContent: {
    gap: spacing.m,
  },
  section: {
    marginBottom: 4,
  },
  songActionButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
  },
  songActionButton: {
    minHeight: touch.minTarget,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    minWidth: 76,
    alignItems: "center",
    justifyContent: "center",
  },
  songActionButtonText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
  localActionRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  scanButton: {
    minHeight: touch.minTarget,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  scanButtonText: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
  clearButton: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  clearButtonText: {
    fontSize: typography.meta,
    fontWeight: "600",
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
    gap: 12,
  },
  modalTitle: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  createInput: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: typography.title,
  },
  coverPickerButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touch.minTarget,
  },
  coverPickerText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  resultInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  modalHint: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  modalButton: {
    minWidth: 80,
    minHeight: touch.minTarget,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  modalButtonText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
});

