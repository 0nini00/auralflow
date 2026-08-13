import React, { memo, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Alert, useWindowDimensions } from "react-native";
import type { MusicInfo } from "@lx/core";
import { AudioLines, CheckCircle2, Circle, Ellipsis, Heart, Music2 } from "lucide-react-native";
import { CachedImage } from "./CachedImage";
import { DownloadQualityModal } from "./DownloadQualityModal";
import { AddToLocalPlaylistModal } from "./AddToLocalPlaylistModal";
import { ActionMenuSheet, type ActionMenuAnchor, type ActionMenuItem } from "./ActionMenuSheet";
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
import { getLastSelectQuality, saveLastSelectQuality } from "@/services/downloadService";
import {
  buildSongListMetadata,
  shouldShowSongListDownloadAction,
  shouldShowSongListLikeAction,
} from "@/services/songListMetadataModel";
import { buildSongQueueActionLabels } from "@/services/songQueueActions";
import { spacing, radius, typography, layout } from "@/theme/tokens";
import { openMvPlayerScreen } from "@/navigation";

export interface SongListProps {
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
  /** 对齐 lx：是否显示封面图。false 时显示序号/播放中图标（lx 我的列表风格） */
  showCover?: boolean;
  showLikeAction?: boolean;
  showMoreAction?: boolean;
  isSongPressable?: (song: MusicInfo, index: number) => boolean;
  onLongPressSong?: (song: MusicInfo, index: number) => void;
  selectionMode?: boolean;
  selectedKeys?: ReadonlySet<string>;
  onToggleSelection?: (song: MusicInfo, index: number) => void;
  onPlayMv?: (song: MusicInfo) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  wy: "网易云",
  tx: "QQ音乐",
  bili: "B站",
  local: "本地",
};

export function SongList({
  songs,
  onPlay,
  emptyText,
  getExtraMetadata,
  onEdit,
  onDelete,
  highlightedIndex,
  hideSourceTag = true,
  showCover = true,
  showLikeAction = true,
  showMoreAction = true,
  isSongPressable,
  onLongPressSong,
  selectionMode = false,
  selectedKeys,
  onToggleSelection,
  onPlayMv,
}: SongListProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const { width } = useWindowDimensions();
  const showDuration = width >= 380;
  const downloadSong = useDownloadStore((state) => state.downloadSong);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue);
  const currentSong = usePlayerStore((state) => state.currentSong);

  // 三个操作弹窗提升到列表根部作为单例，避免每行都实例化 Modal 组件树。
  const [actionSong, setActionSong] = useState<MusicInfo | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<ActionMenuAnchor | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [qualityModalVisible, setQualityModalVisible] = useState(false);
  const [pendingQuality, setPendingQuality] = useState<DownloadQuality | null>(null);
  const [downloading, setDownloading] = useState(false);
  // 上次选择的下载音质（记住上次选择，对齐 lx）
  const [defaultQuality, setDefaultQuality] = useState<DownloadQuality | null>(null);

  if (songs.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>{emptyText || "暂无歌曲"}</Text>
      </View>
    );
  }

  const openMenu = (song: MusicInfo, anchor: ActionMenuAnchor) => {
    setActionSong(song);
    setMenuAnchor(anchor);
    setMenuVisible(true);
  };
  const openAddToPlaylist = (song: MusicInfo) => {
    setActionSong(song);
    setAddToPlaylistVisible(true);
  };
  const openDownload = (song: MusicInfo) => {
    setActionSong(song);
    // 记住上次选择的音质（对齐 lx），异步读取后回填为默认选中
    void getLastSelectQuality().then((last) => {
      if (last) setDefaultQuality(last);
    });
    setQualityModalVisible(true);
  };

  const handleDownloadSelected = async (quality: DownloadQuality) => {
    if (!actionSong || downloading) return;
    setPendingQuality(quality);
    setDownloading(true);
    try {
      // 记住本次选择，下次默认选中
      void saveLastSelectQuality(quality);
      const result = await downloadSong(actionSong, quality);
      if (result.status === "completed" || result.status === "skipped") {
        setQualityModalVisible(false);
      } else if (result.status === "failed") {
        setQualityModalVisible(false);
        Alert.alert("下载失败", result.error ?? "下载失败");
      }
    } finally {
      setDownloading(false);
      setPendingQuality(null);
    }
  };

  const menuItems = (song: MusicInfo): ActionMenuItem[] => {
    const showDownloadAction = shouldShowSongListDownloadAction(song);
    const downloadStatus = useDownloadStore.getState();
    const status = selectDownloadStatus(downloadStatus, song);
    const progress = selectDownloadProgress(downloadStatus, song);
    const downloadLabel =
      status === "completed"
        ? "已下"
        : status === "downloading"
        ? `${Math.round(progress * 100)}%`
        : status === "failed"
        ? "重试"
        : "下载";
    const items: ActionMenuItem[] = [
      { label: buildSongQueueActionLabels().playNextLabel, icon: "playNext", onPress: () => playNextInQueue(song) },
      { label: buildSongQueueActionLabels().addToQueueLabel, icon: "addToQueue", onPress: () => addToQueue(song) },
      { label: "收藏到歌单", icon: "playlist", onPress: () => openAddToPlaylist(song) },
    ];
    if (showDownloadAction) {
      items.push({
        label: downloadLabel,
        icon: "download",
        onPress: () => openDownload(song),
        disabled: status === "completed",
      });
    }
    const mvId = song.source === "wy" ? song.mvId : undefined;
    if (mvId) {
      items.push({
        label: "播放 MV",
        icon: "mv",
        onPress: () => {
          if (onPlayMv) {
            onPlayMv(song);
            return;
          }
          openMvPlayerScreen({
            mvId,
            title: song.name,
            artist: song.singer,
            posterUrl: song.img || song.picUrl,
          });
        },
      });
    }
    items.push({ label: "分享", icon: "share", onPress: () => void shareMusic(song).catch(() => undefined) });
    if (onEdit) {
      const songIndex = songs.indexOf(song);
      items.push({ label: "编辑", icon: "edit", onPress: () => onEdit(song, songIndex >= 0 ? songIndex : 0) });
    }
    if (onDelete) {
      const songIndex = songs.indexOf(song);
      items.push({ label: "移除", icon: "delete", danger: true, onPress: () => onDelete(song, songIndex >= 0 ? songIndex : 0) });
    }
    return items;
  };

  return (
    <View style={styles.listContent}>
      {songs.map((song, index) => {
        const key = `${song.source}:${song.id}`;
        const pressable = selectionMode || (isSongPressable?.(song, index) ?? true);
        return (
          <SongItem
            key={`${song.source}-${song.id}-${index}`}
            index={index}
            song={song}
            onPress={() => selectionMode ? onToggleSelection?.(song, index) : onPlay(song, index)}
            pressable={pressable}
            isPlaying={currentSong?.source === song.source && currentSong?.id === song.id}
            showCover={showCover}
            onEdit={onEdit ? () => onEdit(song, index) : undefined}
            onDelete={onDelete ? () => onDelete(song, index) : undefined}
            extraMetadata={getExtraMetadata?.(song, index)}
            highlighted={highlightedIndex === index}
            hideSourceTag={hideSourceTag}
            selectionMode={selectionMode}
            selected={selectedKeys?.has(key) ?? false}
            showLikeAction={showLikeAction && shouldShowSongListLikeAction(song)}
            showMoreAction={showMoreAction}
            showDuration={showDuration}
            onLongPress={
              !selectionMode && onLongPressSong
                ? () => onLongPressSong(song, index)
                : undefined
            }
            onOpenMenu={(anchor) => openMenu(song, anchor)}
          />
        );
      })}

      {/* 单例弹窗：菜单 */}
      <ActionMenuSheet
        visible={menuVisible}
        title={actionSong?.name ?? ""}
        items={actionSong ? menuItems(actionSong) : []}
        anchor={menuAnchor}
        onClose={() => {
          setMenuVisible(false);
          setMenuAnchor(null);
        }}
      />
      {/* 单例弹窗：加入歌单 */}
      {actionSong ? (
        <AddToLocalPlaylistModal
          visible={addToPlaylistVisible}
          song={actionSong}
          onClose={() => setAddToPlaylistVisible(false)}
        />
      ) : null}
      {/* 单例弹窗：选择音质下载 */}
      <DownloadQualityModal
        visible={qualityModalVisible}
        song={actionSong}
        pendingQuality={pendingQuality}
        defaultQuality={defaultQuality}
        onClose={() => setQualityModalVisible(false)}
        onDownload={handleDownloadSelected}
      />
    </View>
  );
}

interface SongItemProps {
  song: MusicInfo;
  index: number;
  onPress: () => void;
  pressable?: boolean;
  /** 是否为当前正在播放的歌曲（lx：主色标题 + 浅色背景高亮） */
  isPlaying?: boolean;
  /** 对齐 lx：false 时左侧显示序号/播放图标（lx 我的列表风格） */
  showCover?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  extraMetadata?: string;
  highlighted?: boolean;
  hideSourceTag?: boolean;
  /** 点击“更多”时打开列表根部的单一菜单弹窗（参数为点击点坐标，用于锚定菜单）。 */
  onOpenMenu: (anchor: ActionMenuAnchor) => void;
  selectionMode?: boolean;
  selected?: boolean;
  showLikeAction?: boolean;
  showMoreAction?: boolean;
  showDuration?: boolean;
  onLongPress?: () => void;
}

export const SongItem = memo(function SongItem({
  song,
  index,
  onPress,
  pressable = true,
  isPlaying = false,
  showCover = true,
  onEdit,
  onDelete,
  extraMetadata,
  highlighted,
  hideSourceTag,
  onOpenMenu,
  selectionMode = false,
  selected = false,
  showLikeAction = true,
  showMoreAction = true,
  showDuration = true,
  onLongPress,
}: SongItemProps) {
  const artwork = song.picUrl || song.img;
  const metadata = buildSongListMetadata(song);
  const isLiked = usePlaylistStore((state) => state.isLiked(song));
  const likeSong = usePlaylistStore((state) => state.likeSong);
  const unlikeSong = usePlaylistStore((state) => state.unlikeSong);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [liking, setLiking] = useState(false);
  const suppressNextPressRef = useRef(false);
  const clearSuppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearSuppressTimerRef.current) clearTimeout(clearSuppressTimerRef.current);
    };
  }, []);

  const handlePressIn = () => {
    if (clearSuppressTimerRef.current) {
      clearTimeout(clearSuppressTimerRef.current);
      clearSuppressTimerRef.current = null;
    }
    suppressNextPressRef.current = false;
  };

  const handlePress = () => {
    if (suppressNextPressRef.current) {
      suppressNextPressRef.current = false;
      if (clearSuppressTimerRef.current) {
        clearTimeout(clearSuppressTimerRef.current);
        clearSuppressTimerRef.current = null;
      }
      return;
    }
    onPress();
  };

  const handleLongPress = () => {
    if (!onLongPress) return;
    suppressNextPressRef.current = true;
    onLongPress();
  };

  const handlePressOut = () => {
    if (!suppressNextPressRef.current) return;
    if (clearSuppressTimerRef.current) clearTimeout(clearSuppressTimerRef.current);
    clearSuppressTimerRef.current = setTimeout(() => {
      suppressNextPressRef.current = false;
      clearSuppressTimerRef.current = null;
    }, 0);
  };

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
      const message = error instanceof Error ? error.message : "操作失败";
      if (message.includes("未登录")) {
        Alert.alert("需要登录", "请在 设置 → 账号与服务 登录网易云账号后再收藏");
      } else {
        Alert.alert("操作失败", message);
      }
    } finally {
      setLiking(false);
    }
  };

  const isActive = isPlaying || highlighted;
  const activeBackground = isActive ? withAlpha(palette.primary, 0.08) : "transparent";

  return (
    <Touchable
      style={[styles.item, { backgroundColor: activeBackground }]}
      activeScale={pressable ? 0.99 : 1}
      activeOpacity={pressable ? 0.92 : 1}
      onPressIn={pressable ? handlePressIn : undefined}
      onPressOut={pressable ? handlePressOut : undefined}
      onPress={pressable ? handlePress : undefined}
      onLongPress={pressable && onLongPress ? handleLongPress : undefined}
      disabled={!pressable}
      accessibilityRole={selectionMode ? "checkbox" : pressable ? "button" : undefined}
      accessibilityState={selectionMode ? { checked: selected } : pressable ? undefined : { disabled: true }}
      accessibilityLabel={selectionMode ? `${selected ? "取消选择" : "选择"}${song.name}` : undefined}
    >
      {selectionMode ? (
        <View style={styles.selectionIcon}>
          {selected ? (
            <CheckCircle2 size={22} color={palette.primary} fill={palette.surface} />
          ) : (
            <Circle size={22} color={palette.textMuted} />
          )}
        </View>
      ) : showCover ? (
        <View style={styles.coverColumn}>
          {artwork ? (
            <CachedImage
              uri={artwork}
              style={styles.artwork}
              fallback={
                <View style={[styles.artwork, styles.artworkFallback, { backgroundColor: palette.surfaceStrong }]}>
                  <Music2 size={20} color={palette.primary} />
                </View>
              }
            />
          ) : (
            <View style={[styles.artwork, styles.artworkFallback, { backgroundColor: palette.surfaceStrong }]}>
              <Music2 size={20} color={palette.primary} />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.indexColumn}>
          {isPlaying ? (
            <AudioLines size={16} color={palette.primary} />
          ) : (
            <Text style={[styles.indexText, { color: isActive ? palette.primary : palette.textSubtle }]}>
              {index + 1}
            </Text>
          )}
        </View>
      )}

      <View style={styles.info}>
        <Text
          style={[styles.songName, { color: isActive ? palette.primary : palette.text }]}
          numberOfLines={1}
        >
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
          {song.source && hideSourceTag === false && (
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

      {!selectionMode ? <View style={styles.actions}>
        {showDuration && metadata.durationLabel ? (
          <Text
            style={[styles.duration, { color: isActive ? palette.primary : palette.textSubtle }]}
            numberOfLines={1}
          >
            {metadata.durationLabel}
          </Text>
        ) : null}
        {showLikeAction ? <Touchable
          style={styles.iconButton}
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
              size={18}
              color={isLiked ? palette.danger : palette.textMuted}
              fill={isLiked ? palette.danger : "none"}
            />
          )}
        </Touchable> : null}

        {showMoreAction ? <Touchable
          style={styles.iconButton}
          activeScale={0.9}
          onPress={(e) => {
            e.stopPropagation();
            onOpenMenu({
              x: (e as any).nativeEvent?.pageX ?? 0,
              y: (e as any).nativeEvent?.pageY ?? 0,
            });
          }}
          accessibilityRole="button"
          accessibilityLabel="更多操作"
        >
          <Ellipsis size={20} color={palette.textMuted} />
        </Touchable> : null}
      </View> : null}
    </Touchable>
  );
});

/** 把 #rrggbb 转成带透明度的 rgba（用于播放中高亮背景） */
function withAlpha(hexColor: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hexColor.trim());
  if (!match) return hexColor;
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const styles = StyleSheet.create({
  listContent: {
    gap: 0,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: typography.meta,
  },
  item: {
    minHeight: layout.songRowMinHeight,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 2,
    // 对齐 lx：无卡片边框/圆角/行间距，纯色行 + 播放高亮
  },
  selectionIcon: {
    width: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  coverColumn: {
    width: 62,
    alignItems: "center",
    justifyContent: "center",
  },
  indexColumn: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  indexText: {
    fontSize: 12,
    fontWeight: "400",
  },
  artwork: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
  },
  artworkFallback: {
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    flex: 1,
    minWidth: 96,
    justifyContent: "center",
    gap: 2,
    paddingRight: 2,
  },
  songName: {
    fontSize: 14,
    fontWeight: "500",
  },
  meta: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  metaText: {
    fontSize: 11,
    minWidth: 0,
    flexShrink: 1,
  },
  // 对齐 lx：歌手与专辑紧凑排列（不再 flex:1 把专辑推到行尾）
  metaTextPrimary: {
    flexShrink: 1,
  },
  separator: {
    fontSize: 11,
    flexShrink: 0,
  },
  source: {
    fontSize: typography.caption,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    flexShrink: 0,
  },
  extraMetaText: {
    fontSize: typography.caption,
  },
  actions: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  duration: {
    width: 40,
    fontSize: 11,
    textAlign: "right",
    marginLeft: 2,
  },
  iconButton: {
    width: 34,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    // 对齐 lx：无圆形底色，纯图标
  },
});
