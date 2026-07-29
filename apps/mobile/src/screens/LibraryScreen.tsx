import React, { useState, useEffect, useMemo } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View, Pressable, Alert, ActivityIndicator, Modal, TextInput, Image } from "react-native";
import { radius, touch, typography } from "@/theme/tokens";
import type { MusicInfo } from "@lx/core";
import type { LocalPlaylist } from "@/services/localPlaylistModel";

import { useHistoryStore } from "@/stores/historyStore";
import { useLocalMusicStore } from "@/stores/localMusicStore";
import { useAccountStore } from "@/stores/accountStore";
import { usePlaylistStore } from "@/stores/playlistStore";
import { useDownloadStore } from "@/stores/downloadStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { buildLibrarySongActions, buildLibrarySongDeleteRequest, shuffleLibrarySongs } from "@/services/librarySongActions";
import { SongList } from "@/components/SongList";
import { DownloadList } from "@/components/DownloadList";
import { BiliCollectionList } from "@/components/BiliCollectionList";
import { QuickActionCard } from "@/components/QuickActionCard";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";

import { PlaylistList } from "@/components/PlaylistList";
import { LocalPlaylistList } from "@/components/LocalPlaylistList";
import { useBiliAccountStore } from "@/stores/biliAccountStore";
import {
  openBiliCollectionDetailScreen,
  openDailyRecommendScreen,
  openLikedSongsScreen,
  openLocalPlaylistDetailScreen,
  openPlaylistDetailScreen,
} from "@/navigation/navigationRef";
import {
  LIBRARY_SECTIONS,
  getLibrarySectionHeader,
  getLibrarySectionTabLabel,
  type LibrarySection,
} from "@/services/librarySectionModel";
import {
  buildLibraryQuickActions,
  type LibraryQuickActionType,
} from "@/services/libraryQuickActions";
import { buildLibraryLocalMusicActions } from "@/services/libraryLocalMusicActions";
import { pickImageFromGallery } from "@/services/imagePickerService";
import { writeLocalMusicCover, writeLocalMusicLyrics } from "@/services/localMusicService";
import {
  buildLocalPlaylistListActionRequest,
  type LocalPlaylistListActionType,
} from "@/services/localPlaylistListActions";
import { buildWyPlaylistGroups } from "@/services/libraryPlaylistGroups";
import {
  buildLibraryContentModelInput,
  getLibraryContentModel,
  type LibraryContentModel,
} from "@/services/libraryContentModel";
import {
  importPlaylistsFromJsonInput,
  shareExportedLocalPlaylists,
  shareExportedPlaylists,
} from "@/services/playlistTransferService";

interface LibraryScreenProps {
  onNavigateToPlayer: () => void;
  activeSection: Exclude<LibrarySection, "downloads">;
  onSelectSection: (section: LibrarySection) => void;
}

type PlaylistContentModel = Extract<
  LibraryContentModel,
  { kind: "playlistLoading" | "playlistLoginRequired" | "playlistList" }
>;

export function LibraryScreen({
  onNavigateToPlayer,
  activeSection,
  onSelectSection,
}: LibraryScreenProps) {
  const history = useHistoryStore((state) => state.history);
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

  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const user = useAccountStore((state) => state.user);
  const checkStatus = useAccountStore((state) => state.checkStatus);

  const playlists = usePlaylistStore((state) => state.playlists);
  const likedPlaylist = usePlaylistStore((state) => state.likedPlaylist);
  const likedSongs = usePlaylistStore((state) => state.likedSongs);
  const localPlaylists = usePlaylistStore((state) => state.localPlaylists);
  const fetchPlaylists = usePlaylistStore((state) => state.fetchPlaylists);
  const fetchLikedSongs = usePlaylistStore((state) => state.fetchLikedSongs);
  const loadLikedSongsFromStorage = usePlaylistStore((state) => state.loadLikedSongsFromStorage);
  const createLocalPlaylist = usePlaylistStore((state) => state.createLocalPlaylist);
  const updateLocalPlaylistInfo = usePlaylistStore((state) => state.updateLocalPlaylistInfo);
  const duplicateLocalPlaylist = usePlaylistStore((state) => state.duplicateLocalPlaylist);
  const deleteLocalPlaylist = usePlaylistStore((state) => state.deleteLocalPlaylist);
  const playlistLoading = usePlaylistStore((state) => state.loading);

  const downloads = useDownloadStore((state) => state.downloads);
  const downloading = useDownloadStore((state) => state.downloading);
  const failedDownloads = useDownloadStore((state) => state.failedDownloads);
  const downloadsLoading = useDownloadStore((state) => state.loading);
  const downloadError = useDownloadStore((state) => state.error);
  const loadDownloads = useDownloadStore((state) => state.loadDownloads);

  // B站合集
  const biliAccount = useBiliAccountStore((state) => state.account);
  const biliPlaylists = useBiliAccountStore((state) => state.playlists);
  const biliIsLoaded = useBiliAccountStore((state) => state.isLoaded);
  const biliLoad = useBiliAccountStore((state) => state.load);

  const [showCreateLocalPlaylistModal, setShowCreateLocalPlaylistModal] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [showImportLocalPlaylistModal, setShowImportLocalPlaylistModal] = useState(false);
  const [localPlaylistName, setLocalPlaylistName] = useState("");
  const [localPlaylistDescription, setLocalPlaylistDescription] = useState("");
  const [localPlaylistImportJson, setLocalPlaylistImportJson] = useState("");
  const [editingLocalPlaylistId, setEditingLocalPlaylistId] = useState<string | null>(null);
  const [editingLocalSong, setEditingLocalSong] = useState<MusicInfo | null>(null);
  const [localSongName, setLocalSongName] = useState("");
  const [localSongSinger, setLocalSongSinger] = useState("");
  const [localSongAlbumName, setLocalSongAlbumName] = useState("");
  const [localSongCoverUrl, setLocalSongCoverUrl] = useState("");
  const [localSongCoverUri, setLocalSongCoverUri] = useState("");
  const [localSongLyrics, setLocalSongLyrics] = useState("");
  const [creatingLocalPlaylist, setCreatingLocalPlaylist] = useState(false);
  const [importingLocalPlaylists, setImportingLocalPlaylists] = useState(false);
  const [exportingLocalPlaylists, setExportingLocalPlaylists] = useState(false);
  const [savingLocalSongMetadata, setSavingLocalSongMetadata] = useState(false);

  // 检查登录状态
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    void loadLikedSongsFromStorage();
  }, [loadLikedSongsFromStorage]);

  // 登录后自动获取歌单
  useEffect(() => {
    if (isLoggedIn && user) {
      fetchPlaylists(user.userId);
      fetchLikedSongs(user.userId);
    }
  }, [isLoggedIn, user, fetchPlaylists, fetchLikedSongs]);

  useEffect(() => {
    loadDownloads();
  }, [loadDownloads]);

  // 加载 B站账号信息（若已保存 Cookie）
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
    onNavigateToPlayer();
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

  const handleLocalPlaylistPress = (playlist: LocalPlaylist) => {
    openLocalPlaylistDetailScreen(playlist.id);
  };

  const openLocalPlaylistEditor = (playlist?: LocalPlaylist) => {
    setEditingLocalPlaylistId(playlist?.id ?? null);
    setLocalPlaylistName(playlist?.name ?? "");
    setLocalPlaylistDescription(playlist?.description ?? "");
    setShowCreateLocalPlaylistModal(true);
  };

  const closeLocalPlaylistEditor = () => {
    setEditingLocalPlaylistId(null);
    setLocalPlaylistName("");
    setLocalPlaylistDescription("");
    setShowCreateLocalPlaylistModal(false);
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

  const handleCreateLocalPlaylist = async () => {
    if (creatingLocalPlaylist) return;
    setCreatingLocalPlaylist(true);
    try {
      if (editingLocalPlaylistId) {
        await updateLocalPlaylistInfo(editingLocalPlaylistId, {
          name: localPlaylistName,
          description: localPlaylistDescription,
        });
      } else {
        await createLocalPlaylist({ name: localPlaylistName, description: localPlaylistDescription });
      }
      closeLocalPlaylistEditor();
    } catch (error) {
      Alert.alert(editingLocalPlaylistId ? "编辑失败" : "创建失败", error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingLocalPlaylist(false);
    }
  };

  const handleExportLocalPlaylists = async () => {
    if (exportingLocalPlaylists) return;
    if (localPlaylists.length === 0) {
      Alert.alert("提示", "没有可导出的本地歌单");
      return;
    }
    setExportingLocalPlaylists(true);
    try {
      await shareExportedPlaylists();
    } catch (error) {
      Alert.alert("导出失败", error instanceof Error ? error.message : String(error));
    } finally {
      setExportingLocalPlaylists(false);
    }
  };

  const handleImportLocalPlaylists = async () => {
    if (importingLocalPlaylists) return;
    setImportingLocalPlaylists(true);
    try {
      const result = await importPlaylistsFromJsonInput(localPlaylistImportJson);
      if (!result.imported) {
        Alert.alert("导入完成", "没有新增歌曲");
        return;
      }
      setLocalPlaylistImportJson("");
      setShowImportLocalPlaylistModal(false);
      Alert.alert("导入成功", `已导入 ${result.addedSongCount} 首歌`);
    } catch (error) {
      Alert.alert("导入失败", error instanceof Error ? error.message : String(error));
    } finally {
      setImportingLocalPlaylists(false);
    }
  };

  const handleLocalPlaylistAction = async (
    playlist: LocalPlaylist,
    action: LocalPlaylistListActionType,
  ) => {
    const request = buildLocalPlaylistListActionRequest(playlist, action);

    switch (request.action) {
      case "edit":
        openLocalPlaylistEditor(request.playlist);
        return;
      case "duplicate":
        try {
          const duplicated = await duplicateLocalPlaylist(request.playlist.id);
          openLocalPlaylistDetailScreen(duplicated.id);
        } catch (error) {
          Alert.alert("复制失败", error instanceof Error ? error.message : String(error));
        }
        return;
      case "export":
        try {
          await shareExportedLocalPlaylists([request.playlist]);
        } catch (error) {
          Alert.alert("导出失败", error instanceof Error ? error.message : String(error));
        }
        return;
      case "delete":
        Alert.alert("删除本地歌单", `确定删除“${request.playlist.name}”吗？`, [
          { text: "取消", style: "cancel" },
          {
            text: "删除",
            style: "destructive",
            onPress: () => {
              void deleteLocalPlaylist(request.playlist.id).catch((error) => {
                Alert.alert("删除失败", error instanceof Error ? error.message : String(error));
              });
            },
          },
        ]);
        return;
    }
  };

  const handleLikedPlaylistPress = () => {
    if (likedPlaylist) {
      openPlaylistDetailScreen(likedPlaylist);
      return;
    }
    if (likedSongs.length > 0) {
      openLikedSongsScreen();
    }
  };

  const getSectionCount = (section: LibrarySection) => {
    switch (section) {
      case "playlists":
        return playlists.length + localPlaylists.length;
      case "history":
        return history.length;
      case "local":
        return localSongs.length;
      case "downloads":
        return downloads.length;
      case "bili":
        return biliPlaylists.length;
    }
  };

  const sectionHeader = getLibrarySectionHeader(
    activeSection === "playlists"
      ? { section: "playlists", isLoggedIn, playlistCount: playlists.length + localPlaylists.length }
      : activeSection === "history"
      ? { section: "history", historyCount: history.length }
      : activeSection === "local"
      ? { section: "local", localLoading, localSongCount: localSongs.length }
      : activeSection === "bili"
      ? { section: "bili", hasBiliAccount: Boolean(biliAccount), biliCollectionCount: biliPlaylists.length }
      : { section: "downloads", downloadsLoading, downloadCount: downloads.length }
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
  const quickActions = buildLibraryQuickActions({
    isLoggedIn,
    likedPlaylistTrackCount: likedPlaylist?.trackCount ?? null,
    likedSongsCount: likedSongs.length,
    likedCoverUri: likedSongs[0]?.img || likedSongs[0]?.picUrl || null,
    historyCoverUri: history[0]?.img || history[0]?.picUrl || null,
  });

  const librarySongActions = buildLibrarySongActions(activeSection, getActiveSongs().length);
  const localMusicActions = buildLibraryLocalMusicActions({
    localSongCount: localSongs.length,
    loading: localLoading,
  });
  const wyPlaylistGroups = useMemo(() => buildWyPlaylistGroups(playlists), [playlists]);

  const contentModel = getLibraryContentModel(
    buildLibraryContentModelInput({
      section: activeSection,
      playlistLoading,
      isLoggedIn,
      historyCount: history.length,
      localLoading,
      localError,
      downloadError,
    })
  );

  const renderPlaylistContent = (model: PlaylistContentModel) => {
    let remoteContent: React.ReactNode;

    switch (model.kind) {
      case "playlistLoading":
        remoteContent = <LoadingState label="正在加载网易云歌单" />;
        break;
      case "playlistLoginRequired":
        remoteContent = <EmptyState title={model.emptyText} />;
        break;
      case "playlistList":
        remoteContent = (
          <View style={styles.remotePlaylistGroups}>
            {wyPlaylistGroups.map((group) => (
              <View key={group.key} style={styles.remotePlaylistGroup}>
                <SectionHeader title={group.title} description={`${group.count} 个`} />
                <PlaylistList
                  playlists={group.playlists}
                  onPress={openPlaylistDetailScreen}
                  emptyText={group.emptyText}
                />
              </View>
            ))}
          </View>
        );
        break;
    }

    return (
      <View style={styles.playlistGroups}>
        <View style={styles.playlistGroup}>
          <SectionHeader title="本地歌单" description={`${localPlaylists.length} 个`} />
          <LocalPlaylistList
            playlists={localPlaylists}
            onPress={handleLocalPlaylistPress}
            onAction={handleLocalPlaylistAction}
            emptyText="还没有本地歌单，点击新建开始整理"
          />
        </View>

        <View style={styles.playlistGroup}>
          <SectionHeader title="网易云歌单" description={`${playlists.length} 个`} />
          {remoteContent}
        </View>
      </View>
    );
  };
  const handleQuickAction = (action: LibraryQuickActionType) => {
    switch (action) {
      case "openLikedPlaylist":
        handleLikedPlaylistPress();
        return;
      case "openDailyRecommend":
        openDailyRecommendScreen();
        return;
    }
  };

  const renderContent = () => {
    switch (contentModel.kind) {
      case "playlistLoading":
      case "playlistLoginRequired":
      case "playlistList":
        return renderPlaylistContent(contentModel);
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
        return (
          <SongList
            songs={contentModel.songSource === "history" ? history : localSongs}
            onPlay={handlePlay}
            onEdit={activeSection === "local" ? handleEditLocalSong : undefined}
            onDelete={librarySongActions.canDeleteSongs ? handleDeleteLibrarySong : undefined}
            emptyText={contentModel.emptyText}
          />
        );
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
          description="歌单、收藏、本地音乐和播放历史。"
          style={styles.section}
        />

      <Modal
        visible={showCreateLocalPlaylistModal}
        animationType="slide"
        transparent
        onRequestClose={closeLocalPlaylistEditor}
      >
        <KeyboardAvoidingView
          style={styles.createModalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[styles.createModalCard, { backgroundColor: palette.surface }]}>
            <Text style={[styles.createModalTitle, { color: palette.text }]}>
              {editingLocalPlaylistId ? "编辑本地歌单" : "新建本地歌单"}
            </Text>
            <TextInput
              value={localPlaylistName}
              onChangeText={setLocalPlaylistName}
              placeholder="输入歌单名称"
              placeholderTextColor={palette.textMuted}
              style={[styles.createInput, { borderColor: palette.border, color: palette.text }]}
            />
            <TextInput
              value={localPlaylistDescription}
              onChangeText={setLocalPlaylistDescription}
              placeholder="描述（可选）"
              placeholderTextColor={palette.textMuted}
              multiline
              style={[styles.createInput, styles.createTextArea, { borderColor: palette.border, color: palette.text }]}
            />
            <View style={styles.createModalActions}>
              <Pressable
                style={styles.createModalButton}
              onPress={closeLocalPlaylistEditor}
              disabled={creatingLocalPlaylist}
            >
                <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.createModalButton, { backgroundColor: palette.primary }]}
                onPress={handleCreateLocalPlaylist}
                disabled={creatingLocalPlaylist}
              >
                {creatingLocalPlaylist ? (
                  <ActivityIndicator color={palette.primaryText} size="small" />
                ) : (
                  <Text style={[styles.createModalButtonText, { color: palette.primaryText }]}>
                    {editingLocalPlaylistId ? "保存" : "创建"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={showImportLocalPlaylistModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowImportLocalPlaylistModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.createModalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[styles.createModalCard, { backgroundColor: palette.surface }]}>
            <Text style={[styles.createModalTitle, { color: palette.text }]}>导入本地歌单</Text>
            <TextInput
              value={localPlaylistImportJson}
              onChangeText={setLocalPlaylistImportJson}
              placeholder="粘贴从 AuralFlow 导出的 JSON"
              placeholderTextColor={palette.textMuted}
              multiline
              style={[styles.createInput, styles.importTextArea, { borderColor: palette.border, color: palette.text }]}
            />
            <View style={styles.createModalActions}>
              <Pressable
                style={styles.createModalButton}
                onPress={() => setShowImportLocalPlaylistModal(false)}
                disabled={importingLocalPlaylists}
              >
                <Text style={[styles.createModalButtonText, { color: palette.textMuted }]}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.createModalButton, { backgroundColor: palette.primary }]}
                onPress={handleImportLocalPlaylists}
                disabled={importingLocalPlaylists}
              >
                {importingLocalPlaylists ? (
                  <ActivityIndicator color={palette.primaryText} size="small" />
                ) : (
                  <Text style={[styles.createModalButtonText, { color: palette.primaryText }]}>导入</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
      <View style={[styles.quickActions, { marginBottom: 24 }]}>
        {quickActions.map((action) => (
          <QuickActionCard
            key={action.action}
            title={action.title}
            subtitle={action.subtitle}
            coverUri={action.coverUri}
            disabled={action.disabled}
            onPress={() => handleQuickAction(action.action)}
          />
        ))}
      </View>

      {/* 切换按钮 */}
      <View style={[styles.segmented, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        {LIBRARY_SECTIONS.map((section) => {
          const active = activeSection === section;
          return (
            <Pressable
              key={section}
              style={[
                styles.segmentButton,
                active && { backgroundColor: palette.primary },
              ]}
              onPress={() => onSelectSection(section)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: palette.textMuted },
                  active && styles.segmentTextActive,
                  active && { color: palette.primaryText },
                ]}
              >
                {getLibrarySectionTabLabel(section, { count: getSectionCount(section) })}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionHeader
        title={sectionHeader.title}
        description={sectionHeader.caption}
        style={styles.section}
        action={(
          <>
          {activeSection === "playlists" && (
          <View style={styles.playlistHeaderActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="导入本地歌单"
              onPress={() => setShowImportLocalPlaylistModal(true)}
              style={[styles.createButton, { backgroundColor: palette.surface }]}
            >
              <Text style={[styles.createButtonText, { color: palette.primary }]}>导入</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="导出本地歌单"
              onPress={handleExportLocalPlaylists}
              style={[styles.createButton, { backgroundColor: palette.surface }]}
              disabled={exportingLocalPlaylists}
            >
              {exportingLocalPlaylists ? (
                <ActivityIndicator color={palette.primary} size="small" />
              ) : (
                <Text style={[styles.createButtonText, { color: palette.primary }]}>导出</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="新建本地歌单"
              onPress={() => openLocalPlaylistEditor()}
              style={[styles.createButton, { backgroundColor: palette.surface }]}
            >
              <Text style={[styles.createButtonText, { color: palette.primary }]}>新建</Text>
            </Pressable>
          </View>
        )}

        {librarySongActions.show && (
          <View style={styles.songActionButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={librarySongActions.playAllLabel}
              onPress={handlePlayAllSongs}
              style={[styles.songActionButton, { backgroundColor: palette.primary }]}
            >
              <Text style={[styles.songActionButtonText, { color: palette.primaryText }]}>
                {librarySongActions.playAllLabel}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={librarySongActions.shuffleLabel}
              onPress={handleShuffleSongs}
              style={[styles.songActionButton, { backgroundColor: palette.surface }]}
            >
              <Text style={[styles.songActionButtonText, { color: palette.primary }]}>
                {librarySongActions.shuffleLabel}
              </Text>
            </Pressable>
          </View>
        )}
        {contentModel.showClearHistory && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清空播放历史"
            onPress={handleClearHistory}
            style={[styles.clearButton, { backgroundColor: palette.dangerSurface }]}
          >
            <Text style={[styles.clearButtonText, { color: palette.danger }]}>清空</Text>
          </Pressable>
        )}
        {contentModel.showLocalScan && (

          <View style={styles.localActionRow}>

            <Pressable

              onPress={handleScanLocal}

              style={[styles.scanButton, { backgroundColor: palette.surface }]}

              disabled={localMusicActions.disabled}

              accessibilityRole="button"

              accessibilityLabel={localMusicActions.scanAccessibilityLabel}

              accessibilityHint={localMusicActions.scanHint}

            >

              {localLoading ? (

                <ActivityIndicator color={palette.primary} size="small" />

              ) : (

                <Text style={[styles.scanButtonText, { color: palette.primary }]}>{localMusicActions.scanLabel}</Text>

              )}

            </Pressable>

            <Pressable

              onPress={() => {

                void handleImportLocalFiles();

              }}

              style={[styles.scanButton, { backgroundColor: palette.surface }]}

              disabled={localMusicActions.disabled}

              accessibilityRole="button"

              accessibilityLabel={localMusicActions.importAccessibilityLabel}

              accessibilityHint={localMusicActions.importHint}

            >

              <Text style={[styles.scanButtonText, { color: palette.primary }]}>

                {localMusicActions.importLabel}

              </Text>

            </Pressable>

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
    marginBottom: 16,
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 24,
  },
  createButton: {
    minHeight: touch.minTarget,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    minWidth: 64,
    alignItems: "center",
  },
  createButtonText: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
  playlistHeaderActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 8,
    maxWidth: 232,
  },
  playlistGroups: {
    gap: 20,
  },
  playlistGroup: {
    gap: 10,
  },
  remotePlaylistGroups: {
    gap: 16,
  },
  remotePlaylistGroup: {
    gap: 10,
  },
  createModalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  createModalCard: {
    borderRadius: radius.lg,
    padding: 20,
    gap: 16,
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
  createTextArea: {
    minHeight: 76,
    textAlignVertical: "top",
  },
  importTextArea: {
    minHeight: 160,
    textAlignVertical: "top",
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
    gap: 12,
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
  songActionButtons: {
    flexDirection: "row",
    gap: 8,
  },
  songActionButton: {
    minHeight: touch.minTarget,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    minWidth: 76,
    alignItems: "center",
  },
  songActionButtonText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
  clearButton: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
  },
  clearButtonText: {
    fontSize: typography.meta,
    fontWeight: "600",
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

  },

  scanButtonText: {

    fontSize: typography.meta,

    fontWeight: "600",

  },
  segmented: {
    flexDirection: "row",
    borderRadius: radius.sm,
    padding: 4,
    marginBottom: 16,
  },
  segmentButton: {
    flex: 1,
    minHeight: touch.minTarget,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: radius.sm,
  },
  segmentText: {
    fontSize: typography.body,
    fontWeight: "500",
  },
  segmentTextActive: {
    fontWeight: "600",
  },
});
