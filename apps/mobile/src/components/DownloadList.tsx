import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MusicInfo } from "@lx/core";

import { useDownloadStore } from "@/stores/downloadStore";
import { usePlayerStore } from "@/stores/playerStore";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { CachedImage } from "@/components/CachedImage";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";
import {
  buildCompletedDownloadMetadata,
  buildDownloadingMetadata,
  buildFailedDownloadMetadata,
  formatDownloadSpeed,
} from "@/services/downloadListMetadataModel";
import { runPlaybackUiAction } from "@/services/playbackUiAction";

interface DownloadListProps {
  downloads: ReturnType<typeof useDownloadStore.getState>["downloads"];
  downloading: ReturnType<typeof useDownloadStore.getState>["downloading"];
  failedDownloads?: ReturnType<typeof useDownloadStore.getState>["failedDownloads"];
  onNavigateToPlayer: () => void;
}

export function DownloadList({ downloads, downloading, failedDownloads = [], onNavigateToPlayer }: DownloadListProps) {
  const removeDownload = useDownloadStore((state) => state.removeDownload);
  const cancelDownload = useDownloadStore((state) => state.cancelDownload);
  const pauseDownload = useDownloadStore((state) => state.pauseDownload);
  const resumeDownload = useDownloadStore((state) => state.resumeDownload);
  const downloadSong = useDownloadStore((state) => state.downloadSong);
  const removeFailedDownload = useDownloadStore((state) => state.removeFailedDownload);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [playbackError, setPlaybackError] = React.useState<string | null>(null);

  if (downloads.length === 0 && downloading.length === 0 && failedDownloads.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>还没有下载记录</Text>
      </View>
    );
  }

  const handlePlay = async (song: MusicInfo, localPath: string) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(() =>
      usePlayerStore.getState().play(song, localPath),
    );
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  };

  const coverFor = (song: MusicInfo) => song.picUrl || song.img;

  return (
    <View style={styles.downloadList}>
      <PlaybackErrorState
        message={playbackError}
        onDismiss={() => setPlaybackError(null)}
      />
      {downloading.map((item) => {
        const key = `${item.song.source}:${item.song.id}:${item.quality}`;
        const metadata = buildDownloadingMetadata(item);
        const isPaused = item.status === "paused";
        const isWaiting = item.status === "waiting";
        const speedLabel = formatDownloadSpeed(item.speed);
        return (
          <View key={key} style={[styles.downloadItem, { backgroundColor: palette.surface }]}>
            <CachedImage
              uri={coverFor(item.song) || ""}
              style={styles.cover}
              fallback={<View style={[styles.coverFallback, { backgroundColor: palette.surfaceStrong }]} />}
            />
            <View style={styles.downloadInfo}>
              <Text style={[styles.downloadSongName, { color: palette.text }]} numberOfLines={1}>
                {item.song.name}
              </Text>
              <Text style={[styles.downloadMeta, { color: palette.textMuted }]} numberOfLines={1}>
                {metadata.titleMeta}
              </Text>
              {isWaiting ? (
                <Text style={[styles.downloadStatus, { color: palette.textMuted }]}>等待中…</Text>
              ) : isPaused ? (
                <Text style={[styles.downloadStatus, { color: palette.textMuted }]}>已暂停</Text>
              ) : (
                <View style={styles.progressBlock}>
                  <View style={[styles.progressTrack, { backgroundColor: palette.surfaceStrong }]}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.max(0, Math.min(100, Math.round((item.progress || 0) * 100)))}%`,
                          backgroundColor: palette.primary,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.progressMetaRow}>
                    <Text style={[styles.downloadDetail, { color: palette.textSubtle }]} numberOfLines={1}>
                      {metadata.detailLabel}
                    </Text>
                    {speedLabel ? (
                      <Text style={[styles.speedText, { color: palette.primary }]} numberOfLines={1}>
                        {speedLabel}
                      </Text>
                    ) : null}
                  </View>
                </View>
              )}
            </View>
            <View style={styles.downloadActions}>
              {isPaused ? (
                <Pressable
                  style={[styles.downloadActionButton, { backgroundColor: palette.background }]}
                  onPress={() => resumeDownload(item.song, item.quality)}
                >
                  <Text style={[styles.downloadActionText, { color: palette.primary }]}>继续</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.downloadActionButton, { backgroundColor: palette.background }]}
                  onPress={() => pauseDownload(item.song, item.quality)}
                >
                  <Text style={[styles.downloadActionText, { color: palette.text }]}>暂停</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.downloadRemoveButton, { backgroundColor: palette.dangerSurface }]}
                onPress={() => cancelDownload(item.song, item.quality)}
              >
                <Text style={[styles.downloadRemoveText, { color: palette.danger }]}>取消</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {failedDownloads.map((item) => {
        const key = `${item.song.source}:${item.song.id}:${item.quality}`;
        const metadata = buildFailedDownloadMetadata(item);
        return (
          <View key={key} style={[styles.downloadItem, { backgroundColor: palette.surface }]}>
            <CachedImage
              uri={coverFor(item.song) || ""}
              style={styles.cover}
              fallback={<View style={[styles.coverFallback, { backgroundColor: palette.surfaceStrong }]} />}
            />
            <View style={styles.downloadInfo}>
              <Text style={[styles.downloadSongName, { color: palette.text }]} numberOfLines={1}>
                {item.song.name}
              </Text>
              <Text style={[styles.downloadMeta, { color: palette.textMuted }]} numberOfLines={1}>
                {metadata.titleMeta}
              </Text>
              <Text style={[styles.downloadStatus, { color: palette.danger }]} numberOfLines={2}>
                {metadata.detailLabel}
              </Text>
            </View>
            <View style={styles.downloadActions}>
              <Pressable
                style={[styles.downloadActionButton, { backgroundColor: palette.background }]}
                onPress={() => void downloadSong(item.song, item.quality)}
              >
                <Text style={[styles.downloadActionText, { color: palette.primary }]}>重试</Text>
              </Pressable>
              <Pressable
                style={[styles.downloadRemoveButton, { backgroundColor: palette.dangerSurface }]}
                onPress={() => removeFailedDownload(item.song, item.quality)}
              >
                <Text style={[styles.downloadRemoveText, { color: palette.danger }]}>移除</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {downloads.map((item) => {
        const quality = item.quality ?? item.song.quality ?? "320k";
        const key = `${item.song.source}:${item.song.id}:${quality}`;
        const metadata = buildCompletedDownloadMetadata(item);
        return (
          <View key={key} style={[styles.downloadItem, { backgroundColor: palette.surface }]}>
            <CachedImage
              uri={coverFor(item.song) || ""}
              style={styles.cover}
              fallback={<View style={[styles.coverFallback, { backgroundColor: palette.surfaceStrong }]} />}
            />
            <View style={styles.downloadInfo}>
              <Text style={[styles.downloadSongName, { color: palette.text }]} numberOfLines={1}>
                {item.song.name}
              </Text>
              <Text style={[styles.downloadMeta, { color: palette.textMuted }]} numberOfLines={1}>
                {metadata.titleMeta}
              </Text>
              <Text style={[styles.downloadStatus, { color: palette.primary }]}>{metadata.statusLabel}</Text>
              <Text style={[styles.downloadDetail, { color: palette.textSubtle }]} numberOfLines={1}>
                {metadata.detailLabel}
              </Text>
            </View>
            <View style={styles.downloadActions}>
              <Pressable
                style={[styles.downloadActionButton, { backgroundColor: palette.background }]}
                onPress={() => handlePlay(item.song, item.localPath)}
              >
                <Text style={[styles.downloadActionText, { color: palette.primary }]}>播放</Text>
              </Pressable>
              <Pressable
                style={[styles.downloadRemoveButton, { backgroundColor: palette.dangerSurface }]}
                onPress={() => removeDownload(item.song, item.quality)}
              >
                <Text style={[styles.downloadRemoveText, { color: palette.danger }]}>删除</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: typography.meta,
  },
  downloadList: {
    gap: spacing.xs,
  },
  downloadItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    padding: spacing.s,
    gap: spacing.s,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
  },
  coverFallback: {
    flex: 1,
    width: "100%",
    borderRadius: radius.sm,
  },
  downloadInfo: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  downloadSongName: {
    fontSize: typography.title,
    fontWeight: "600",
  },
  downloadMeta: {
    fontSize: typography.caption,
  },
  downloadStatus: {
    fontSize: typography.caption,
  },
  downloadDetail: {
    fontSize: 11,
  },
  progressBlock: {
    gap: 4,
    marginTop: 2,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  progressMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  speedText: {
    fontSize: 11,
    fontWeight: "600",
  },
  downloadActions: {
    gap: spacing.xs,
    alignItems: "flex-end",
  },
  downloadActionButton: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
  },
  downloadActionText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  downloadRemoveButton: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
  },
  downloadRemoveText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
});
