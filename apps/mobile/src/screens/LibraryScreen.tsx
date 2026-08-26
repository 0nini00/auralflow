import React, { useState, useEffect } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View, Pressable, Alert, ActivityIndicator, Modal, TextInput, Image } from "react-native";
import { radius, spacing, touch, typography } from "@/theme/tokens";
import type { MusicInfo } from "@lx/core";

import { useHistoryStore } from "@/stores/historyStore";
import { useLocalMusicStore } from "@/stores/localMusicStore";
import { useDownloadStore } from "@/stores/downloadStore";
import { useBiliAccountStore } from "@/stores/biliAccountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { buildLibrarySongActions, buildLibrarySongDeleteRequest } from "@/services/librarySongActions";
import { SongList } from "@/components/SongList";
import { DownloadList } from "@/components/DownloadList";
import { HistorySection } from "@/components/HistorySection";
import { BiliCollectionList } from "@/components/BiliCollectionList";
import { ActionButton } from "@/components/ActionButton";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { ErrorState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { openBiliCollectionDetailScreen } from "@/navigation/navigationRef";
import { type LibrarySection } from "@/services/librarySectionModel";
import { pickImageFromGallery } from "@/services/imagePickerService";
import { writeLocalMusicCover, writeLocalMusicLyrics, isDownloadedLocalSong } from "@/services/localMusicService";
import {
  buildLibraryContentModelInput,
  getLibraryContentModel,
} from "@/services/libraryContentModel";

interface LibraryScreenProps {
  onNavigateToPlayer: () => void;
  activeSection: LibrarySection;
  onSelectSection: (section: LibrarySection) => void;
}

export function LibraryScreen({
  onNavigateToPlayer,
  activeSection,
  onSelectSection,
}: LibraryScreenProps) {
  const history = useHistoryStore((state) => state.history);
  const historyEntries = useHistoryStore((state) => state.entries);
  const clearHistory = useHistoryStore((state) => state.clearHistory);
  const removeFromHistory = useHistoryStore((state) => state.removeFromHistory);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);

  const localSongs = useLocalMusicStore((state) => state.localSongs);
  const scanMusic = useLocalMusicStore((state) => state.scanMusic);
  const importLocalFiles = useLocalMusicStore((state) => state.importLocalFiles);
  const removeLocalSong = useLocalMusicStore((state) => state.removeLocalSong);
  const updateLocalSongMetadata = useLocalMusicStore((state) => state.updateLocalSongMetadata);
  const localLoading = useLocalMusicStore((state) => state.loading);
  const localError = useLocalMusicStore((state) => state.error);

  const downloads = useDownloadStore((state) => state.downloads);
  const downloading = useDownloadStore((state) => state.downloading);
  const failedDownloads = useDownloadStore((state) => state.failedDownloads);
  const downloadsLoading = useDownloadStore((state) => state.loading);
  const downloadError = useDownloadStore((state) => state.error);
  const loadDownloads = useDownloadStore((state) => state.loadDownloads);

  // B站合集
  const biliLoad = useBiliAccountStore((state) => state.load);

  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [editingLocalSong, setEditingLocalSong] = useState<MusicInfo | null>(null);
  const [localSongName, setLocalSongName] = useState("");
  const [localSongSinger, setLocalSongSinger] = useState("");
  const [localSongAlbumName, setLocalSongAlbumName] = useState("");
  const [localSongCoverUrl, setLocalSongCoverUrl] = useState("");
  const [localSongCoverUri, setLocalSongCoverUri] = useState("");
  const [localSongLyrics, setLocalSongLyrics] = useState("");
  const [savingLocalSongMetadata, setSavingLocalSongMetadata] = useState(false);

  useEffect(() => {
    loadDownloads();
  }, [loadDownloads]);

  useEffect(() => {
    biliLoad();
  }, [biliLoad]);

  const getActiveSongs = (): MusicInfo[] => activeSection === "history"
    ? history
    : activeSection === "local"
    ? localSongs
    : [];

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  };

  const handlePlay = async (_song: MusicInfo, index: number) => {
    await runPlayback(() => playQueue(getActiveSongs(), index));
  };

  const handleEditLocalSong = (song: MusicInfo) => {
    setEditingLocalSong(song);
    setLocalSongName(song.name);
    setLocalSongSinger(song.singer || "");
    setLocalSongAlbumName(song.albumName || "");
    setLocalSongCoverUrl(song.picUrl || song.img || "");
    setLocalSongCoverUri("");
    setLocalSongLyrics(song.localLyrics || "");
  };

  const closeLocalSongEditor = () => {
    setEditingLocalSong(null);
    setLocalSongName("");
    setLocalSongSinger("");
    setLocalSongAlbumName("");
    setLocalSongCoverUrl("");
    setLocalSongCoverUri("");
    setLocalSongLyrics("");
  };

  const handlePickCover = async () => {
    try {
      const uri = await pickImageFromGallery();
      if (uri) {
        setLocalSongCoverUri(uri);
        setLocalSongCoverUrl("");
      }
    } catch (error) {
      Alert.alert("选择封面失败", error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveLocalSongMetadata = async () => {
    if (!editingLocalSong || savingLocalSongMetadata) return;
    setSavingLocalSongMetadata(true);
    try {
      const mediaId = String(editingLocalSong.id);
      const coverValue = localSongCoverUri || localSongCoverUrl;
      await updateLocalSongMetadata(
        { id: editingLocalSong.id, source: editingLocalSong.source },
        {
          name: localSongName,
          singer: localSongSinger,
          albumName: localSongAlbumName,
          coverUrl: coverValue,
          localLyrics: localSongLyrics,
        },
      );
      // 封面与歌词写入音频文件标签（对齐桌面端 set_audio_cover / set_audio_lyrics）。
      // 下载目录入库的歌曲没有 MediaStore 媒体 id，原生写回必然失败：仅更新列表元数据。
      if (!isDownloadedLocalSong(editingLocalSong)) {
        if (localSongCoverUri) {
          await writeLocalMusicCover(mediaId, localSongCoverUri);
        }
        await writeLocalMusicLyrics(mediaId, localSongLyrics);
      }
      closeLocalSongEditor();
    } catch (error) {
      Alert.alert("编辑失败", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingLocalSongMetadata(false);
    }
  };

  const handleClearHistory = () => {
    clearHistory();
  };

  const handleDeleteLibrarySong = (song: MusicInfo) => {
    const request = buildLibrarySongDeleteRequest(activeSection, song);
    if (request.type === "history") {
      void removeFromHistory(request.songId, request.source);
      return;
    }
    if (request.type === "local") {
      Alert.alert(request.title, request.message, [
        { text: "取消", style: "cancel" },
        {
          text: request.confirmLabel,
          style: "destructive",
          onPress: () => {
            void removeLocalSong(request.song).catch((error) => {
              Alert.alert("移除失败", error instanceof Error ? error.message : String(error));
            });
          },
        },
      ]);
    }
  };

  const handleScanLocal = async () => {
    try {
      const previousCount = localSongs.length;
      await scanMusic();
      const nextSongs = useLocalMusicStore.getState().localSongs;
      if (nextSongs.length === 0) {
        Alert.alert("提示", "未找到本地音乐文件");
      } else if (previousCount === 0) {
        onSelectSection("local");
      }
    } catch (error) {
      Alert.alert("扫描失败", error instanceof Error ? error.message : String(error));
    }
  };

  const handleImportLocalFiles = async () => {
    try {
      const previousCount = localSongs.length;
      const result = await importLocalFiles();
      if (result.added === 0) {
        Alert.alert("提示", previousCount === result.total ? "未选择新文件，或所选文件已在曲库中" : "未选择文件");
        return;
      }
      onSelectSection("local");
      Alert.alert("导入完成", `新增 ${result.added} 首，当前共 ${result.total} 首本地歌曲`);
    } catch (error) {
      Alert.alert("导入失败", error instanceof Error ? error.message : String(error));
    }
  };

  const librarySongActions = buildLibrarySongActions(activeSection, getActiveSongs().length);

  const contentModel = getLibraryContentModel(
    buildLibraryContentModelInput({
      section: activeSection,
      historyCount: history.length,
      localLoading,
      localError,
      downloadError,
    })
  );

  const renderContent = () => {
    switch (contentModel.kind) {
      case "biliCollections":
        return <BiliCollectionList onCollectionPress={openBiliCollectionDetailScreen} />;
      case "downloads":
        return (
          <DownloadList
            downloads={downloads}
            downloading={downloading}
            failedDownloads={failedDownloads}
            onNavigateToPlayer={onNavigateToPlayer}
          />
        );
      case "songList":
        if (contentModel.songSource === "history") {
          return (
            <HistorySection
              entries={historyEntries}
              onPlay={(songs, index) => runPlayback(() => playQueue(songs, index))}
              onDelete={librarySongActions.canDeleteSongs ? handleDeleteLibrarySong : undefined}
              emptyText={contentModel.emptyText}
            />
          );
        }
        return (
          <SongList
            songs={localSongs}
            onPlay={handlePlay}
            onEdit={handleEditLocalSong}
            onDelete={librarySongActions.canDeleteSongs ? handleDeleteLibrarySong : undefined}
            emptyText={contentModel.emptyText}
          />
        );
      default:
        return null;
    }
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView>
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />
        <Modal
          visible={Boolean(editingLocalSong)}
          animationType="slide"
          transparent
          onRequestClose={closeLocalSongEditor}
        >
          <KeyboardAvoidingView
            style={styles.createModalOverlay}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={[styles.createModalCard, { backgroundColor: palette.surface }]}>
              <Text style={[styles.createModalTitle, { color: palette.text }]}>编辑本地音乐</Text>
              <TextInput
                value={localSongName}
                onChangeText={setLocalSongName}
                placeholder="歌曲标题"
                placeholderTextColor={palette.textMuted}
                style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
              />
              <TextInput
                value={localSongSinger}
                onChangeText={setLocalSongSinger}
                placeholder="歌手"
                placeholderTextColor={palette.textMuted}
                style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
              />
              <TextInput
                value={localSongAlbumName}
                onChangeText={setLocalSongAlbumName}
                placeholder="专辑"
                placeholderTextColor={palette.textMuted}
                style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
              />
              <TextInput
                value={localSongCoverUrl}
                onChangeText={(text) => {
                  setLocalSongCoverUrl(text);
                  setLocalSongCoverUri("");
                }}
                placeholder="封面 URL（可选，不写入文件）"
                placeholderTextColor={palette.textMuted}
                style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
              />
              <Pressable
                style={[styles.createInput, styles.coverPickerButton, { borderColor: palette.border }]}
                onPress={handlePickCover}
              >
                <Text style={[styles.coverPickerText, { color: palette.primary }]}>
                  {localSongCoverUri ? "已选择本地图片（将写入文件）" : "从相册选择封面图片"}
                </Text>
              </Pressable>
              {localSongCoverUri ? (
                <Image source={{ uri: localSongCoverUri }} style={styles.coverPreview} />
              ) : null}
              <TextInput
                value={localSongLyrics}
                onChangeText={setLocalSongLyrics}
                placeholder="LRC 或纯文本歌词，留空清除"
                placeholderTextColor={palette.textMuted}
                multiline
                style={[styles.createInput, styles.editLocalSongLyricsInput, { borderColor: palette.border, color: palette.text }]}
              />
              <Text style={[styles.editLocalSongHint, { color: palette.textMuted }]}>标题、歌手、专辑会更新到系统媒体库；从相册选择的封面与歌词会写入音频文件（可能需授权修改媒体文件），留空可清除内嵌歌词。</Text>
              <View style={styles.createModalActions}>
                <Pressable
                  style={styles.createModalButton}
                  onPress={closeLocalSongEditor}
                  disabled={savingLocalSongMetadata}
                >
                  <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>取消</Text>
                </Pressable>
                <Pressable
                  style={[styles.createModalButton, { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 }]}
                  onPress={handleSaveLocalSongMetadata}
                  disabled={savingLocalSongMetadata}
                >
                  {savingLocalSongMetadata ? (
                    <ActivityIndicator color={palette.primary} size="small" />
                  ) : (
                    <Text style={[styles.createModalButtonText, { color: palette.primary }]}>保存</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {(contentModel.showClearHistory || contentModel.showLocalScan) && (
          <View style={styles.sectionActions}>
            {contentModel.showLocalScan && (
              <>
                <View style={styles.actionButtonItem}>
                  <ActionButton
                    small
                    grow
                    accessibilityLabel="扫描本地音乐"
                    onPress={handleScanLocal}
                    label="扫描本地"
                  />
                </View>
                <View style={styles.actionButtonItem}>
                  <ActionButton
                    small
                    grow
                    accessibilityLabel="添加本地音乐文件"
                    onPress={() => {
                      void handleImportLocalFiles();
                    }}
                    label="添加文件"
                  />
                </View>
              </>
            )}
            {contentModel.showClearHistory && (
              <ActionButton
                small
                variant="danger"
                accessibilityLabel="清空播放历史"
                onPress={handleClearHistory}
                label="清空"
              />
            )}
          </View>
        )}

        {contentModel.error && (
          <ErrorState message={contentModel.error} />
        )}

        {renderContent()}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  // 操作按钮独立成行放在标题下方：不再挤在 SectionHeader 右侧
  // （本地页最多 4 个按钮，塞标题旁边会换行错乱、对不齐）
  sectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.m,
  },
  // 四键一排平分宽度，不换行（播放全部/随机播放/扫描本地/添加文件）
  actionButtonItem: {
    flex: 1,
  },
  createModalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  createModalCard: {
    borderRadius: radius.lg,
    padding: spacing.l,
    gap: spacing.m,
  },
  createModalTitle: {
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
  editLocalSongHint: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  editLocalSongLyricsInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  coverPickerButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  coverPickerText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  coverPreview: {
    width: 96,
    height: 96,
    borderRadius: radius.sm,
    marginTop: 8,
    resizeMode: "cover",
  },
  createModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.s,
  },
  createModalButton: {
    minWidth: 80,
    minHeight: touch.minTarget,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  createModalButtonText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
});