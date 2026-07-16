import React, { memo, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import type { MusicInfo } from "@lx/core";
import { Ellipsis, Heart, ListStart, Music2 } from "lucide-react-native";
import { CachedImage } from "./CachedImage";
import { DownloadQualityModal } from "./DownloadQualityModal";
import { AddToLocalPlaylistModal } from "./AddToLocalPlaylistModal";
import { ActionMenuSheet, type ActionMenuItem } from "./ActionMenuSheet";
import { Touchable } from "./Touchable";
import { usePlaylistStore } from "@/stores/playlistStore";
import { useDownloadStore, type DownloadQuality } from "@/stores/downloadStore";
import { usePlayerStore } from "@/stores/playerStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { shareMusic } from "@/services/shareMusicService";
import {
  selectDownloadProgress,
  selectDownloadStatus,
} from "@/services/downloadRecordSelectors";
import { buildSongListMetadata, shouldShowSongListDownloadAction } from "@/services/songListMetadataModel";
import { buildSongQueueActionLabels } from "@/services/songQueueActions";
import { spacing, radius, typography, touch, layout } from "@/theme/tokens";

interface SongListProps {
  songs: MusicInfo[];
  onPlay: (song: MusicInfo, index: number) => void;
  emptyText?: string;
  getExtraMetadata?: (song: MusicInfo, index: number) => string | undefined;
  onEdit?: (song: MusicInfo, index: number) => void;
  /** 可选：每行末尾显示删除按钮（用于下载页等管理场景） */
  onDelete?: (song: MusicInfo, index: number) => void;
  highlightedIndex?: number | null;
  /** 可选：隐藏每行的来源小标签。详情页里所有歌曲同源，逐行显示来源是噪声 */
  hideSourceTag?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  wy: "网易云",
  tx: "QQ音乐",
  bili: "B站",
  local: "本地",
};

export function SongList({ songs, onPlay, emptyText, getExtraMetadata, onEdit, onDelete, highlightedIndex, hideSourceTag }: SongListProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  if (songs.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>{emptyText || "暂无歌曲"}</Text>
      </View>
    );
  }

  return (
    <View style={styles.listContent}>
      {songs.map((song, index) => (
        <SongItem
          key={`${song.source}-${song.id}-${index}`}
          song={song}
          onPress={() => onPlay(song, index)}
          onEdit={onEdit ? () => onEdit(song, index) : undefined}
          onDelete={onDelete ? () => onDelete(song, index) : undefined}
          extraMetadata={getExtraMetadata?.(song, index)}
          highlighted={highlightedIndex === index}
          hideSourceTag={hideSourceTag}
        />
      ))}
    </View>
  );
}

interface SongItemProps {
  song: MusicInfo;
  onPress: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  extraMetadata?: string;
  highlighted?: boolean;
  hideSourceTag?: boolean;
}

const SongItem = memo(function SongItem({ song, onPress, onEdit, onDelete, extraMetadata, highlighted, hideSourceTag }: SongItemProps) {
  const artwork = song.picUrl || song.img;
  const metadata = buildSongListMetadata(song);
  const isLiked = usePlaylistStore((state) => state.isLiked(song));
  const likeSong = usePlaylistStore((state) => state.likeSong);
  const unlikeSong = usePlaylistStore((state) => state.unlikeSong);
  const downloadSong = useDownloadStore((state) => state.downloadSong);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue);
  const downloadStatus = useDownloadStore((state) =>
    selectDownloadStatus(state, song),
  );
  const downloadProgress = useDownloadStore((state) =>
    selectDownloadProgress(state, song),
  );
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [liking, setLiking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [qualityModalVisible, setQualityModalVisible] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [pendingQuality, setPendingQuality] = useState<DownloadQuality | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const queueActionLabels = buildSongQueueActionLabels();

  const handleLike = async (e: any) => {
    e.stopPropagation();
    if (liking) return;
    setLiking(true);
    try {
      if (isLiked) {
        await unlikeSong(song);
      } else {
        await likeSong(song);
      }
    } catch (error) {
      console.error("Like/unlike error:", error);
    } finally {
      setLiking(false);
    }
  };

  const handleDownloadPress = (e?: any) => {
    e?.stopPropagation();
    if (downloading || downloadStatus === "completed") return;
    setQualityModalVisible(true);
  };

  const handleQualitySelect = async (quality: DownloadQuality) => {
    if (downloading) return;
    setPendingQuality(quality);
    setDownloading(true);
    try {
      await downloadSong(song, quality);
      setQualityModalVisible(false);
    } catch (error) {
      console.error("Download song error:", error);
    } finally {
      setDownloading(false);
      setPendingQuality(null);
    }
  };

  const handleShare = async (e?: any) => {
    e?.stopPropagation();
    try {
      await shareMusic(song);
    } catch (error) {
      console.error("Share music error:", error);
    }
  };
  const handlePlayNext = (e?: any) => {
    e?.stopPropagation();
    playNextInQueue(song);
  };

  const handleAddToQueue = (e?: any) => {
    e?.stopPropagation();
    addToQueue(song);
  };

  const handleAddToPlaylistPress = (e?: any) => {
    e?.stopPropagation();
    setAddToPlaylistVisible(true);
  };

  const downloadLabel = downloadStatus === "completed"
    ? "已下"
    : downloadStatus === "downloading"
    ? `${Math.round(downloadProgress * 100)}%`
    : downloadStatus === "failed"
    ? "重试"
    : "下载";
  const showDownloadAction = shouldShowSongListDownloadAction(song);

  const menuItems = React.useMemo(() => {
    const items: ActionMenuItem[] = [
      { label: queueActionLabels.playNextLabel, icon: "playNext", onPress: handlePlayNext },
      { label: queueActionLabels.addToQueueLabel, icon: "addToQueue", onPress: handleAddToQueue },
      { label: "收藏到歌单", icon: "playlist", onPress: handleAddToPlaylistPress },
    ];
    if (showDownloadAction) {
      items.push({
        label: downloadLabel,
        icon: "download",
        onPress: handleDownloadPress,
        disabled: downloading || downloadStatus === "completed",
      });
    }
    items.push({ label: "分享", icon: "share", onPress: handleShare });
    if (onEdit) {
      items.push({ label: "编辑", icon: "edit", onPress: onEdit });
    }
    if (onDelete) {
      items.push({ label: "删除", icon: "delete", danger: true, onPress: onDelete });
    }
    return items;
  }, [
    queueActionLabels,
    showDownloadAction,
    downloadLabel,
    downloading,
    downloadStatus,
    onEdit,
    onDelete,
  ]);

  return (
    <Touchable
      style={[styles.item, { backgroundColor: palette.surface }, highlighted && { borderColor: palette.primary }]}
      activeScale={0.99}
      activeOpacity={0.92}
      onPress={onPress}
    >
      {artwork ? (
        <CachedImage
          uri={artwork}
          style={styles.artwork}
          fallback={
            <View style={[styles.artwork, styles.artworkFallback, { backgroundColor: palette.surfaceStrong }]}>
              <Music2 size={22} color={palette.primary} />
            </View>
          }
        />
      ) : (
        <View style={[styles.artwork, styles.artworkFallback, { backgroundColor: palette.surfaceStrong }]}>
          <Music2 size={22} color={palette.primary} />
        </View>
      )}

      <View style={styles.info}>
        <Text style={[styles.songName, { color: palette.text }]} numberOfLines={1}>
          {song.name}
        </Text>
        <View style={styles.meta}>
          {metadata.metaParts.map((part, partIndex) => (
            <React.Fragment key={`${part}-${partIndex}`}>
              {partIndex > 0 ? (
                <Text style={[styles.separator, { color: palette.textSubtle }]}>·</Text>
              ) : null}
              <Text
                style={[
                  styles.metaText,
                  { color: palette.textMuted },
                  partIndex === 0 && styles.metaTextPrimary,
                ]}
                numberOfLines={1}
              >
                {part}
              </Text>
            </React.Fragment>
          ))}
          {song.source && !hideSourceTag && (
            <>
              <Text style={[styles.separator, { color: palette.textSubtle }]}>·</Text>
              <Text
                style={[
                  styles.source,
                  { color: palette.textMuted, backgroundColor: palette.surfaceStrong },
                ]}
              >
                {SOURCE_LABELS[song.source] || song.source}
              </Text>
            </>
          )}
        </View>
        {extraMetadata ? (
          <Text style={[styles.extraMetaText, { color: palette.textSubtle }]} numberOfLines={1}>
            {extraMetadata}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Touchable
          style={[styles.iconButton, { backgroundColor: palette.surfaceStrong }]}
          activeScale={0.9}
          onPress={handleLike}
          disabled={liking}
          accessibilityRole="button"
          accessibilityLabel={isLiked ? "取消喜欢" : "喜欢歌曲"}
          accessibilityState={{ disabled: liking, selected: isLiked }}
        >
          {liking ? (
            <ActivityIndicator color={palette.danger} size="small" />
          ) : (
            <Heart
              size={20}
              color={isLiked ? palette.danger : palette.textMuted}
              fill={isLiked ? palette.danger : "none"}
            />
          )}
        </Touchable>

        <Touchable
          style={[styles.iconButton, { backgroundColor: palette.surfaceStrong }]}
          activeScale={0.9}
          onPress={handlePlayNext}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="下一首播放"
        >
          <ListStart size={20} color={palette.textMuted} />
        </Touchable>

        <Touchable
          style={[styles.iconButton, { backgroundColor: palette.surfaceStrong }]}
          activeScale={0.9}
          onPress={(e) => {
            e.stopPropagation();
            setMenuVisible(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="更多操作"
        >
          <Ellipsis size={22} color={palette.textMuted} />
        </Touchable>
      </View>

      <ActionMenuSheet
        visible={menuVisible}
        title={song.name}
        items={menuItems}
        onClose={() => setMenuVisible(false)}
      />

      <AddToLocalPlaylistModal
        visible={addToPlaylistVisible}
        song={song}
        onClose={() => setAddToPlaylistVisible(false)}
      />
      <DownloadQualityModal
        visible={qualityModalVisible}
        song={song}
        pendingQuality={pendingQuality}
        onClose={() => setQualityModalVisible(false)}
        onDownload={handleQualitySelect}
      />
    </Touchable>
  );
});

const styles = StyleSheet.create({
  listContent: {
    gap: spacing.s,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: typography.meta,
    color: "#8fa79f",
  },
  item: {
    minHeight: layout.songRowMinHeight,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
    padding: layout.songRowPadding,
    borderRadius: radius.md,
    gap: spacing.s,
  },
  artwork: {
    width: layout.artworkSize,
    height: layout.artworkSize,
    borderRadius: radius.sm,
  },
  artworkFallback: {
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.xxs,
  },
  songName: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  metaText: {
    fontSize: typography.meta,
    flexShrink: 1,
  },
  metaTextPrimary: {
    flex: 1,
  },
  separator: {
    fontSize: typography.meta,
  },
  source: {
    fontSize: typography.caption,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  extraMetaText: {
    fontSize: typography.caption,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  iconButton: {
    width: touch.minTarget,
    height: touch.minTarget,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
