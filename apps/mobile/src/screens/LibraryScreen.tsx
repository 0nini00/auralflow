import React, { useCallback, useMemo, useState, useEffect } from "react";
import { StyleSheet, Text, View, Alert } from "react-native";
import { layout, spacing } from "@/theme/tokens";
import type { MusicInfo } from "@lx/core";

import { useHistoryStore } from "@/stores/historyStore";
import { useLocalMusicStore } from "@/stores/localMusicStore";
import { useDownloadStore } from "@/stores/downloadStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { buildLibrarySongActions, buildLibrarySongDeleteRequest } from "@/services/librarySongActions";
import { SongList } from "@/components/SongList";
import { DownloadList } from "@/components/DownloadList";
import { HistorySection } from "@/components/HistorySection";
import { ActionButton } from "@/components/ActionButton";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { ErrorState, LoadingState } from "@/components/ScreenState";
import { SegmentedChips } from "@/components/SegmentedChips";
import { FavoritesSection } from "@/components/library/FavoritesSection";
import { PlaylistsSection } from "@/components/library/PlaylistsSection";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { type LibrarySection as LibraryContentSection } from "@/services/librarySectionModel";
import {
  buildLibraryContentModelInput,
  getLibraryContentModel,
} from "@/services/libraryContentModel";
import { useLibrarySectionStore, type LibrarySection } from "@/stores/librarySectionStore";

interface LibraryScreenProps {
  onNavigateToPlayer: () => void;
}

const LIBRARY_SEGMENTS: readonly { key: LibrarySection; label: string }[] = [
  { key: "playlists", label: "歌单" },
  { key: "local", label: "本地" },
  { key: "favorites", label: "收藏" },
  { key: "history", label: "历史" },
  { key: "downloads", label: "下载" },
] as const;

export function LibraryScreen({ onNavigateToPlayer }: LibraryScreenProps) {
  const section = useLibrarySectionStore((state) => state.section);
  const requestSection = useLibrarySectionStore((state) => state.requestSection);
  // 内容模型只认识 local/history/downloads；歌单与收藏走独立分支
  const contentSection: LibraryContentSection =
    section === "history" || section === "downloads" ? section : "local";
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
  const localLoading = useLocalMusicStore((state) => state.loading);
  const localError = useLocalMusicStore((state) => state.error);
  const scanProgress = useLocalMusicStore((state) => state.scanProgress);

  const downloadsLoading = useDownloadStore((state) => state.loading);
  const downloadError = useDownloadStore((state) => state.error);
  const loadDownloads = useDownloadStore((state) => state.loadDownloads);
  // downloads/downloading 数组的进度订阅下沉到 LibraryDownloadsSection：
  // 下载期间每个进度 tick（约每 5%）都会 set 一次数组，
  // 在此整屏订阅会让曲库列表跟着反复 reconcile


  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    loadDownloads();
  }, [loadDownloads]);

  const activeSongs = useMemo<MusicInfo[]>(
    () => (contentSection === "history" ? history : contentSection === "local" ? localSongs : []),
    [contentSection, history, localSongs],
  );

  const runPlayback = useCallback(async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  }, []);

  // useCallback：SongList 的 memo 行依赖 onPlay，引用不稳定会让全部行失去 memo 意义
  const handlePlay = useCallback(
    async (_song: MusicInfo, index: number) => {
      await runPlayback(() => playQueue(activeSongs, index));
    },
    [activeSongs, runPlayback],
  );

  const handleClearHistory = () => {
    clearHistory();
  };

  const handleDeleteLibrarySong = useCallback((song: MusicInfo, dayStart?: number) => {
    const request = buildLibrarySongDeleteRequest(contentSection, song);
    if (request.type === "history") {
      void removeFromHistory(request.songId, request.source, dayStart);
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
  }, [contentSection, removeFromHistory, removeLocalSong]);

  const handleScanLocal = async () => {
    // 扫描期间重复点击会排起多次完整扫描；按钮已禁用，这里再兜一层。
    if (localLoading) return;
    try {
      const previousCount = localSongs.length;
      await scanMusic();
      const nextSongs = useLocalMusicStore.getState().localSongs;
      if (nextSongs.length === 0) {
        Alert.alert("提示", "未找到本地音乐文件");
      } else if (previousCount === 0) {
        requestSection("local");
      }
    } catch (error) {
      Alert.alert("扫描失败", error instanceof Error ? error.message : String(error));
    }
  };

  const handleImportLocalFiles = async () => {
    if (localLoading) return;
    try {
      const previousCount = localSongs.length;
      const result = await importLocalFiles();
      if (result.added === 0) {
        Alert.alert("提示", previousCount === result.total ? "未选择新文件，或所选文件已在曲库中" : "未选择文件");
        return;
      }
      requestSection("local");
      Alert.alert("导入完成", `新增 ${result.added} 首，当前共 ${result.total} 首本地歌曲`);
    } catch (error) {
      Alert.alert("导入失败", error instanceof Error ? error.message : String(error));
    }
  };

  const librarySongActions = buildLibrarySongActions(contentSection, activeSongs.length);

  const contentModel = getLibraryContentModel(
    buildLibraryContentModelInput({
      section: contentSection,
      historyCount: history.length,
      localLoading,
      localError,
      downloadError,
    })
  );

  const renderContent = () => {
    if (contentModel.kind === "songList" && contentModel.loading) {
      return <LoadingState label="正在读取本地音乐" />;
    }
    switch (contentModel.kind) {
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
            hideSourceTag
            onDelete={librarySongActions.canDeleteSongs ? handleDeleteLibrarySong : undefined}
            emptyText={contentModel.emptyText}
          />
        );
      default:
        return null;
    }
  };

  // 本地曲库可达上千首：走虚拟化列表（SongList 本体即滚动容器），头部内容进 ListHeaderComponent；
  // 历史等其余分支维持 ScreenScrollView 结构；下载拥有独立虚拟列表。
  const isLocalVirtualList = section === "local" && contentModel.kind === "songList" && contentModel.songSource === "local";
  const playbackErrorNode = (
    <PlaybackErrorState
      message={playbackError}
      onDismiss={() => setPlaybackError(null)}
    />
  );
  const sectionActionsNode =
    contentModel.showClearHistory || contentModel.showLocalScan ? (
      <View style={styles.sectionActions}>
        {contentModel.showLocalScan && (
          <>
            <View style={styles.actionButtonItem}>
              <ActionButton
                small
                grow
                accessibilityLabel="扫描本地音乐"
                onPress={handleScanLocal}
                label={scanProgress
                  ? (scanProgress.total > 0 ? `扫描中 ${scanProgress.scanned}/${scanProgress.total}` : "扫描中…")
                  : "扫描本地"}
                disabled={localLoading}
                loading={localLoading}
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
                disabled={localLoading}
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
    ) : null;
  const contentErrorNode = contentModel.error ? <ErrorState message={contentModel.error} /> : null;

  return (
    <ScreenScaffold>
      <SegmentedChips items={LIBRARY_SEGMENTS} value={section} onChange={requestSection} />
      {section === "playlists" ? (
        <ScreenScrollView>
          <PlaylistsSection />
        </ScreenScrollView>
      ) : section === "favorites" ? (
        <ScreenScrollView>
          <FavoritesSection />
        </ScreenScrollView>
      ) : section === "downloads" ? (
        <LibraryDownloadsSection onNavigateToPlayer={onNavigateToPlayer}
          ListHeaderComponent={<>{playbackErrorNode}{contentErrorNode}</>} />
      ) : isLocalVirtualList ? (
        <SongList
          virtualized
          songs={localSongs}
          onPlay={handlePlay}
          hideSourceTag
          onDelete={librarySongActions.canDeleteSongs ? handleDeleteLibrarySong : undefined}
          ListHeaderComponent={
            <>
              {playbackErrorNode}
              {sectionActionsNode}
              {contentErrorNode}
            </>
          }
          contentContainerStyle={styles.listContent}
        />
      ) : (
      <ScreenScrollView>
        {playbackErrorNode}
        {sectionActionsNode}
        {contentErrorNode}
        {renderContent()}
      </ScreenScrollView>
      )}
    </ScreenScaffold>
  );
}

/** 下载区叶子组件：进度数组的订阅隔离在此，进度 tick 不再波及整屏 */
function LibraryDownloadsSection({ onNavigateToPlayer, ListHeaderComponent }: {
  onNavigateToPlayer: () => void; ListHeaderComponent: React.ReactElement;
}) {
  const downloads = useDownloadStore((state) => state.downloads);
  const downloading = useDownloadStore((state) => state.downloading);
  const failedDownloads = useDownloadStore((state) => state.failedDownloads);
  return (
    <DownloadList
      downloads={downloads}
      downloading={downloading}
      failedDownloads={failedDownloads}
      onNavigateToPlayer={onNavigateToPlayer}
      ListHeaderComponent={ListHeaderComponent}
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  // 对齐 ScreenScrollView 的页面内边距约定（本地曲库虚拟化列表本体即滚动容器）
  listContent: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xs,
    paddingBottom: spacing.l,
  },
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
});
