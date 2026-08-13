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
import { buildLibrarySongActions, buildLibrarySongDeleteRequest, shuffleLibrarySongs } from "@/services/librarySongActions";
import { SongList } from "@/components/SongList";
import { DownloadList } from "@/components/DownloadList";
import { HistorySection } from "@/components/HistorySection";
import { BiliCollectionList } from "@/components/BiliCollectionList";
import { ActionButton } from "@/components/ActionButton";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { ErrorState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { openBiliCollectionDetailScreen } from "@/navigation/navigationRef";
import {
  type LibrarySection,
  getLibrarySectionHeader,
} from "@/services/librarySectionModel";
import { buildLibraryLocalMusicActions } from "@/services/libraryLocalMusicActions";
import { pickImageFromGallery } from "@/services/imagePickerService";
import { writeLocalMusicCover, writeLocalMusicLyrics } from "@/services/localMusicService";
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
  const biliAccount = useBiliAccountStore((state) => state.account);
  const biliPlaylists = useBiliAccountStore((state) => state.playlists);
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

  const handlePlayAllSongs = async () => {
    const songs = getActiveSongs();
    if (songs.length === 0) return;
    await runPlayback(() => playQueue(songs, 0));
  };

  const handleShuffleSongs = async () => {
    const songs = getActiveSongs();
    if (songs.length === 0) return;
    await runPlayback(() => playQueue(shuffleLibrarySongs(songs), 0));
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
      if (localSongCoverUri) {
        await writeLocalMusicCover(mediaId, localSongCoverUri);
      }
      await writeLocalMusicLyrics(mediaId, localSongLyrics);
      closeLocalSongEditor();
    } catch (error) {
      Alert.alert("编辑失败", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingLocalSongMetadata(false);
    }
  };

  const sectionHeader = getLibrarySectionHeader(
    activeSection === "history"
      ? { section: "history", historyCount: history.length }
      : activeSection === "local"
      ? { section: "local", localLoading, localSongCount: localSongs.length }
      : activeSection === "downloads"
      ? { section: "downloads", downloadsLoading, downloadCount: downloads.length }
      : { section: "bili", hasBiliAccount: Boolean(biliAccount), biliCollectionCount: biliPlaylists.length }
  );
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
  const localMusicActions = buildLibraryLocalMusicActions({
    localSongCount: localSongs.length,
    loading: localLoading,
  });

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
        <SectionHeader
          title="曲库"
          description={biliAccount ? "本地音乐、播放历史、下载与 B站合集。" : "本地音乐、播放历史与下载。"}
          style={styles.section}
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
                placeholder="艺术家"
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
              <Text style={[styles.editLocalSongHint, { color: palette.textMuted }]}>标题、歌手、专辑会更新到系统媒体库；从相册选择的封面与歌词会写入音频文件（可能需授权修改媒体文件），留空歌词可清除内嵌歌词。</Text>
              <View style={styles.createModalActions}>
                <Pressable
                  style={styles.createModalButton}
                  onPress={closeLocalSongEditor}
                  disabled={savingLocalSongMetadata}
                >
                  <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>取消</Text>
                </Pressable>
                <Pressable
                  style={[styles.createModalButton, { backgroundColor: palette.primary }]}
                  onPress={handleSaveLocalSongMetadata}
                  disabled={savingLocalSongMetadata}
                >
                  {savingLocalSongMetadata ? (
                    <ActivityIndicator color={palette.primaryText} size="small" />
                  ) : (
                    <Text style={[styles.createModalButtonText, { color: palette.primaryText }]}>保存</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <SectionHeader
          title={sectionHeader.title}
          description={sectionHeader.caption}
          style={styles.section}
          action={(
            <>
              {librarySongActions.show && (
                <View style={styles.songActionButtons}>
                  <ActionButton
                    small
                    variant="primary"
                    accessibilityLabel={librarySongActions.playAllLabel}
                    onPress={handlePlayAllSongs}
                    label={librarySongActions.playAllLabel}
                  />
                  <ActionButton
                    small
                    accessibilityLabel={librarySongActions.shuffleLabel}
                    onPress={handleShuffleSongs}
                    label={librarySongActions.shuffleLabel}
                  />
                </View>
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
              {contentModel.showLocalScan && (
                <View style={styles.localActionRow}>
                  <ActionButton
                    small
                    accessibilityLabel={localMusicActions.scanAccessibilityLabel}
                    loading={localLoading}
                    onPress={handleScanLocal}
                    disabled={localMusicActions.disabled}
                    label={localMusicActions.scanLabel}
                  />
                  <ActionButton
                    small
                    accessibilityLabel={localMusicActions.importAccessibilityLabel}
                    onPress={() => {
                      void handleImportLocalFiles();
                    }}
                    disabled={localMusicActions.disabled}
                    label={localMusicActions.importLabel}
                  />
                </View>
              )}
            </>
          )}
        />

        {contentModel.error && (
          <ErrorState message={contentModel.error} />
        )}

        {renderContent()}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.m,
  },
  songActionButtons: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  localActionRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
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