import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MusicInfo } from "@lx/core";

import { useDownloadStore } from "@/stores/downloadStore";
import { usePlayerStore } from "@/stores/playerStore";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import {
  buildCompletedDownloadMetadata,
  buildDownloadingMetadata,
  buildFailedDownloadMetadata,
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
    onNavigateToPlayer();
  };

  return (
    <View style={styles.downloadList}>
      <PlaybackErrorState
        message={playbackError}
        onDismiss={() => setPlaybackError(null)}
      />
      {downloading.map((item) => {
        const key = `${item.song.source}:${item.song.id}:${item.quality}`;
        const metadata = buildDownloadingMetadata(item);
        return (
          <View key={key} style={[styles.downloadItem, { backgroundColor: palette.surface }]}> 
            <View style={styles.downloadInfo}>
              <Text style={[styles.downloadSongName, { color: palette.text }]} numberOfLines={1}>
                {item.song.name}
              </Text>
              <Text style={[styles.downloadMeta, { color: palette.textMuted }]} numberOfLines={1}>
                {metadata.titleMeta}
              </Text>
              <Text style={[styles.downloadStatus, { color: palette.primary }]}> 
                {metadata.statusLabel}
              </Text>
              <Text style={[styles.downloadDetail, { color: palette.textSubtle }]} numberOfLines={1}>
                {metadata.detailLabel}
              </Text>
            </View>
            <View style={styles.downloadActions}>
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
    fontSize: 14,
    color: "#8fa79f",
  },
  downloadList: {
    gap: 10,
  },
  downloadItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a3a31",
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  downloadInfo: {
    flex: 1,
    gap: 4,
  },
  downloadSongName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  downloadMeta: {
    fontSize: 12,
    color: "#8fa79f",
  },
  downloadStatus: {
    fontSize: 12,
    color: "#45e58d",
  },
  downloadDetail: {
    fontSize: 11,
    color: "#5a6a67",
  },
  downloadActions: {
    gap: 8,
    alignItems: "flex-end",
  },
  downloadActionButton: {
    backgroundColor: "#10241f",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  downloadActionText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#45e58d",
  },
  downloadRemoveButton: {
    backgroundColor: "#3a1a1a",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  downloadRemoveText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ff6b6b",
  },
});
