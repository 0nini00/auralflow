import React from "react";
import { radius, touch, typography } from "@/theme/tokens";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { MusicInfo } from "@lx/core";
import { useDownloadStore } from "@/stores/downloadStore";
import { usePlayerStore } from "@/stores/playerStore";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { SongList } from "@/components/SongList";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import {
  buildCompletedDownloadMetadata,
  buildDownloadingMetadata,
  buildFailedDownloadMetadata,
} from "@/services/downloadListMetadataModel";
import {
  formatDownloadDirectoryLabel,
  getDownloadDirectoryPath,
} from "@/services/downloadService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";

interface DownloadScreenProps {
  onNavigateToPlayer: () => void;
}

export function DownloadScreen({ onNavigateToPlayer }: DownloadScreenProps) {
  const downloads = useDownloadStore((state) => state.downloads);
  const downloading = useDownloadStore((state) => state.downloading);
  const failedDownloads = useDownloadStore((state) => state.failedDownloads);
  const downloadSong = useDownloadStore((state) => state.downloadSong);
  const removeDownload = useDownloadStore((state) => state.removeDownload);
  const removeFailedDownload = useDownloadStore((state) => state.removeFailedDownload);
  const clearDownloads = useDownloadStore((state) => state.clearDownloads);
  const cancelDownload = useDownloadStore((state) => state.cancelDownload);
  const defaultQuality = usePlaybackSettingsStore((state) => state.defaultQuality);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [playbackError, setPlaybackError] = React.useState<string | null>(null);
  const downloadDirPath = getDownloadDirectoryPath();
  const downloadDirLabel = formatDownloadDirectoryLabel(downloadDirPath);
  const downloadedSongs = downloads.map((item) => ({
    ...item.song,
    quality: item.quality ?? item.song.quality,
  }));
  const downloadedMetadataBySong = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const item of downloads) {
      const quality = item.quality ?? item.song.quality ?? "320k";
      map.set(`${item.song.source}:${item.song.id}:${quality}`, buildCompletedDownloadMetadata(item).detailLabel);
    }
    return map;
  }, [downloads]);
  const localPathBySong = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const item of downloads) {
      map.set(`${item.song.source}:${item.song.id}:${item.quality ?? item.song.quality ?? "320k"}`, item.localPath);
    }
    return map;
  }, [downloads]);
  /** 播放已下载歌曲：使用本地 file:// 路径 */
  const handlePlayDownloaded = async (song: MusicInfo, _index: number) => {
    const localPath = localPathBySong.get(`${song.source}:${song.id}:${song.quality ?? "320k"}`);
    if (!localPath) {
      Alert.alert("提示", "本地文件不存在，可能已被删除");
      return;
    }
    // 直接用本地路径播放，不走 parseUrl
    const result = await runPlaybackUiAction(() =>
      usePlayerStore.getState().play(song, localPath),
    );
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
    onNavigateToPlayer();
  };
  const handleDelete = (song: MusicInfo) => {
    Alert.alert("删除下载", `确定删除「${song.name}」的下载文件吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void removeDownload(song);
        },
      },
    ]);
  };
  const handleClearAll = () => {
    if (downloads.length === 0) return;
    Alert.alert("清理已完成下载", `确定清理全部 ${downloads.length} 首已下载歌曲？`, [
      { text: "取消", style: "cancel" },
      {
        text: "清理已完成",
        style: "destructive",
        onPress: () => {
          void clearDownloads();
        },
      },
    ]);
  };
  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.container}>
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />
        <SectionHeader
          title="下载中心"
          description={downloads.length > 0
            ? `已下载 ${downloads.length} 首，失败 ${failedDownloads.length} 个`
            : "下载歌曲后即可离线播放"}
          action={downloads.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清理已完成下载"
              style={[styles.clearButton, { backgroundColor: palette.dangerSurface }]}
              onPress={handleClearAll}
            >
              <Text style={[styles.clearText, { color: palette.danger }]}>清理已完成</Text>
            </Pressable>
          ) : undefined}
          style={styles.header}
        />
      <View style={[styles.infoCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.infoLabel, { color: palette.textMuted }]}>保存位置</Text>
        <Text style={[styles.infoValue, { color: palette.text }]} selectable>
          {downloadDirLabel}
        </Text>
        <Text style={[styles.infoHint, { color: palette.textMuted }]} numberOfLines={2}>
          完整路径：{downloadDirPath}
        </Text>
        <Text style={[styles.infoMeta, { color: palette.textMuted }]}>
          默认音质：{defaultQuality} · 移动端目录由系统沙盒固定，无法像桌面端随意更改
        </Text>
      </View>
      {/* 下载中进度 */}
      {downloading.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="下载中" />
          <View style={[styles.card, { backgroundColor: palette.surface }]}>
            {downloading.map((item) => (
              <DownloadingRow
                key={`${item.song.source}:${item.song.id}:${item.quality}`}
                song={item.song}
                quality={item.quality}
                progress={item.progress}
                bytesWritten={item.bytesWritten}
                contentLength={item.contentLength}
                onCancel={() => cancelDownload(item.song, item.quality)}
                palette={palette}
              />
            ))}
          </View>
        </View>
      )}
      {/* 下载失败 */}
      {failedDownloads.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="下载失败" />
          <View style={[styles.card, { backgroundColor: palette.surface }]}>
            {failedDownloads.map((item) => (
              <FailedDownloadRow
                key={`${item.song.source}:${item.song.id}:${item.quality}`}
                song={item.song}
                quality={item.quality}
                error={item.error}
                onRetry={() => void downloadSong(item.song, item.quality)}
                onRemove={() => removeFailedDownload(item.song, item.quality)}
                palette={palette}
              />
            ))}
          </View>
        </View>
      )}
      {/* 已下载列表 */}
      <View style={styles.section}>
        <SectionHeader title="已下载" />
        {downloadedSongs.length === 0 ? (
          <EmptyState
            title="还没有下载的歌曲"
            description="在搜索或歌单中点击「下载」按钮，歌曲会保存到这里供离线播放"
          />
        ) : (
          <SongList
            songs={downloadedSongs}
            onPlay={handlePlayDownloaded}
            onDelete={handleDelete}
            getExtraMetadata={(song) => downloadedMetadataBySong.get(`${song.source}:${song.id}:${song.quality ?? "320k"}`)}
            emptyText="暂无下载"
          />
        )}
      </View>
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

interface DownloadingRowProps {
  song: MusicInfo;
  quality: string;
  progress: number;
  bytesWritten: number;
  contentLength: number;
  onCancel: () => void;
  palette: ReturnType<typeof getThemePalette>;
}

function DownloadingRow({
  song,
  quality,
  progress,
  bytesWritten,
  contentLength,
  onCancel,
  palette,
}: DownloadingRowProps) {
  const metadata = buildDownloadingMetadata({ song, quality, progress, bytesWritten, contentLength });
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <View style={styles.downloadingRow}>
      <View style={styles.downloadingInfo}>
        <Text style={[styles.downloadingName, { color: palette.text }]} numberOfLines={1}>
          {song.name}
        </Text>
        <Text style={[styles.downloadingMeta, { color: palette.textMuted }]} numberOfLines={1}>
          {metadata.titleMeta}
        </Text>
        <Text style={[styles.downloadingDetail, { color: palette.textSubtle }]} numberOfLines={1}>
          {metadata.detailLabel}
        </Text>
      </View>
      <View style={styles.downloadingRight}>
        <View style={[styles.progressTrack, { backgroundColor: palette.surfaceStrong }]}>
          <View
            style={[styles.progressFill, { width: `${percent}%`, backgroundColor: palette.primary }]}
          />
        </View>
        <Text style={[styles.progressText, { color: palette.primary }]}>{percent}%</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`取消下载 ${song.name}`}
          style={styles.cancelButton}
          onPress={onCancel}
        >
          <ActivityIndicator color={palette.danger} size="small" />
          <Text style={[styles.cancelText, { color: palette.danger }]}>取消</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface FailedDownloadRowProps {
  song: MusicInfo;
  quality: string;
  error: string;
  onRetry: () => void;
  onRemove: () => void;
  palette: ReturnType<typeof getThemePalette>;
}

function FailedDownloadRow({
  song,
  quality,
  error,
  onRetry,
  onRemove,
  palette,
}: FailedDownloadRowProps) {
  const metadata = buildFailedDownloadMetadata({ song, quality, error });
  return (
    <View style={styles.failedRow}>
      <View style={styles.downloadingInfo}>
        <Text style={[styles.downloadingName, { color: palette.text }]} numberOfLines={1}>
          {song.name}
        </Text>
        <Text style={[styles.downloadingMeta, { color: palette.textMuted }]} numberOfLines={1}>
          {metadata.titleMeta}
        </Text>
        <Text style={[styles.failedReason, { color: palette.danger }]} numberOfLines={2}>
          {metadata.detailLabel}
        </Text>
      </View>
      <View style={styles.failedActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`重试下载 ${song.name}`}
          style={[styles.retryButton, { backgroundColor: palette.surfaceStrong }]}
          onPress={onRetry}
        >
          <Text style={[styles.retryText, { color: palette.primary }]}>重试</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`移除失败下载 ${song.name}`}
          style={[styles.removeFailedButton, { backgroundColor: palette.dangerSurface }]}
          onPress={onRemove}
        >
          <Text style={[styles.removeFailedText, { color: palette.danger }]}>移除</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
    gap: 4,
  },
  infoLabel: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  infoValue: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  infoHint: {
    fontSize: typography.caption,
    lineHeight: 16,
  },
  infoMeta: {
    fontSize: typography.caption,
    marginTop: 4,
  },
  clearButton: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
  section: {
    gap: 10,
  },
  card: {
    borderRadius: radius.md,
    padding: 12,
    gap: 12,
  },
  downloadingRow: {
    alignItems: "stretch",
    gap: 12,
  },
  failedRow: {
    alignItems: "stretch",
    gap: 12,
  },
  downloadingInfo: {
    flex: 1,
    gap: 2,
  },
  downloadingName: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  downloadingMeta: {
    fontSize: typography.caption,
  },
  downloadingDetail: {
    fontSize: typography.caption,
  },
  downloadingRight: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  progressTrack: {
    width: 70,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  progressText: {
    fontSize: typography.caption,
    fontWeight: "600",
    minWidth: 34,
  },
  cancelButton: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    justifyContent: "center",
  },
  cancelText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  failedReason: {
    fontSize: typography.caption,
    lineHeight: 16,
  },
  failedActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  retryButton: {
    minHeight: touch.minTarget,
    minWidth: 52,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  removeFailedButton: {
    minHeight: touch.minTarget,
    minWidth: 52,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  removeFailedText: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
});
