import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TouchableWithoutFeedback, View, useWindowDimensions } from "react-native";
import type { MusicInfo } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import type { ImmersiveQueuePanelModel } from "@/services/playerQueueModel";
import {
  shouldShowSongListDownloadAction,
} from "@/services/songListMetadataModel";
import { usePlayerStore } from "@/stores/playerStore";
import { useDownloadStore, type DownloadQuality } from "@/stores/downloadStore";
import { getLastSelectQuality, saveLastSelectQuality } from "@/services/downloadService";
import { shareMusic } from "@/services/shareMusicService";
import { openMvPlayerScreen } from "@/navigation";
import { SongItem } from "@/components/SongList";
import { ActionMenuSheet, type ActionMenuAnchor, type ActionMenuItem } from "@/components/ActionMenuSheet";
import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { DownloadQualityModal } from "@/components/DownloadQualityModal";
import { BottomSheet } from "@/components/BottomSheet";
import { Touchable } from "@/components/Touchable";

const ROW_HEIGHT = 64;
/** sheet 形态的面板高度占窗口比例（对齐 lx PlayerPlaylist 的比例式高度） */
const QUEUE_SHEET_HEIGHT_RATIO = 0.72;

export interface QueueModalProps {
  visible: boolean;
  queueModel: ImmersiveQueuePanelModel;
  /** 完整播放队列（用于渲染 lx 风格行：封面/时长/喜欢/更多） */
  queue: MusicInfo[];
  palette: ThemePalette;
  onClose: () => void;
  onPlayItem: (index: number) => void;
  onRemoveItem: (index: number) => void;
  onClear: () => void;
  /**
   * 队列菜单内发起路由跳转（如「播放 MV」）前的回调。
   * 全屏播放页整体是 RN Modal（浮于导航栈之上），必须先关闭播放页再压路由，
   * 否则新页面被盖住不可见；迷你播放栏场景无覆盖层，不传即可。
   */
  onRequestNavigate?: () => void;
  /**
   * 呈现形态：
   * - "modal"（默认）：RN Modal 居中卡片。用于迷你播放栏（宿主容器不满屏，
   *   无法承载应用内覆盖层）。
   * - "sheet"：应用内底部弹层（BottomSheet，非 Modal）。用于全屏播放页——
   *   队列面板与子弹窗不再构成嵌套 Modal，根除 Android 嵌套 Modal 白屏问题。
   */
  presentation?: "modal" | "sheet";
}

/**
 * 播放队列面板（对齐 lx PlayerPlaylist）。
 *
 * 行样式复用 SongItem（lx 风格：封面/歌名/歌手·专辑/时长/喜欢/更多），
 * 更多菜单含队列专属的「从队列移除」。打开时自动滚动到当前播放曲。
 * 全屏播放器（ImmersiveModals）与迷你播放器（PlayerBar）共用。
 */
export function QueueModal({
  visible,
  queueModel,
  queue,
  palette,
  onClose,
  onPlayItem,
  onRemoveItem,
  onClear,
  onRequestNavigate,
  presentation = "modal",
}: QueueModalProps) {
  const listRef = useRef<FlatList<MusicInfo>>(null);
  const { height: windowHeight } = useWindowDimensions();
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue);
  const downloadSong = useDownloadStore((state) => state.downloadSong);

  // 单例弹窗
  const [actionSong, setActionSong] = useState<MusicInfo | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<ActionMenuAnchor | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);
  const [downloadVisible, setDownloadVisible] = useState(false);
  const [pendingQuality, setPendingQuality] = useState<DownloadQuality | null>(null);
  const [downloading, setDownloading] = useState(false);
  // 子弹窗打开时先收起队列面板，避免嵌套 Modal 在 Android 上出现白屏
  const [subSheetOpen, setSubSheetOpen] = useState(false);
  // 上次选择的下载音质（记住上次选择，对齐 lx）
  const [defaultQuality, setDefaultQuality] = useState<DownloadQuality | null>(null);

  // 打开面板时滚动到当前播放曲（对齐 lx PlayerPlaylist scrollToIndex）
  const currentItemIndex = useMemo(
    () => queueModel.items.findIndex((item) => item.isCurrent),
    [queueModel.items],
  );

  useEffect(() => {
    if (!visible || currentItemIndex < 0) return;
    const timer = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: currentItemIndex, viewPosition: 0, animated: true });
      } catch {
        // 列表尚未布局完成时忽略
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [visible, currentItemIndex]);

  const handleDownloadSelected = async (quality: DownloadQuality) => {
    if (!actionSong || downloading) return;
    setPendingQuality(quality);
    setDownloading(true);
    try {
      // 记住本次选择，下次默认选中（对齐 lx）
      void saveLastSelectQuality(quality);
      const result = await downloadSong(actionSong, quality);
      if (result.status === "completed" || result.status === "skipped" || result.status === "failed") {
        setDownloadVisible(false);
      }
    } finally {
      setDownloading(false);
      setPendingQuality(null);
    }
  };

  const openDownload = (song: MusicInfo) => {
    setActionSong(song);
    void getLastSelectQuality().then((last) => {
      if (last) setDefaultQuality(last);
    });
    setSubSheetOpen(true);
    setDownloadVisible(true);
  };

  const openQueueMenu = (song: MusicInfo, _index: number, anchor: ActionMenuAnchor) => {
    // 锚定菜单直接悬浮在队列面板上方（对齐 lx ListMenu），不收起面板、保留上下文；
    // 仅当继续打开「收藏到歌单/下载」等全屏底部弹层时才收起面板（避免嵌套 Modal 白屏）。
    // 注意：不缓存打开菜单时的行下标——菜单打开期间队列可能变动（移除/插播），
    // 移除等操作在触发时按歌曲身份重新解析下标，避免删错行。
    setActionSong(song);
    setMenuAnchor(anchor);
    setMenuVisible(true);
  };

  // SongItem 的稳定回调签名是 (song, anchor)；接回队列菜单（下标在触发时重解析）
  const handleRowMenu = useCallback(
    (song: MusicInfo, anchor: ActionMenuAnchor) => openQueueMenu(song, -1, anchor),
    [],
  );

  const menuItems: ActionMenuItem[] = useMemo(() => {
    if (!actionSong) return [];
    const song = actionSong;
    // 按歌曲身份解析当前下标：菜单打开期间队列变动后仍指向正确的行
    const songIndex = queue.findIndex(
      (item) => item.source === song.source && String(item.id) === String(song.id),
    );
    const items: ActionMenuItem[] = [
      { label: "下一首播放", icon: "playNext", onPress: () => playNextInQueue(song) },
      { label: "加入队列", icon: "addToQueue", onPress: () => addToQueue(song) },
      {
        label: "收藏到歌单",
        icon: "playlist",
        onPress: () => {
          setSubSheetOpen(true);
          setAddToPlaylistVisible(true);
        },
      },
    ];
    if (shouldShowSongListDownloadAction(song)) {
      items.push({
        label: "下载",
        icon: "download",
        onPress: () => openDownload(song),
      });
    }
    const mvId = song.source === "wy" ? song.mvId : undefined;
    if (mvId) {
      items.push({
        label: "播放 MV",
        icon: "mv",
        onPress: () => {
          onRequestNavigate?.();
          openMvPlayerScreen({ mvId, title: song.name, artist: song.singer, posterUrl: song.img || song.picUrl });
        },
      });
    }
    items.push({ label: "分享", icon: "share", onPress: () => void shareMusic(song).catch(() => undefined) });
    if (songIndex !== currentItemIndex) {
      items.push({
        label: "从队列移除",
        icon: "delete",
        danger: true,
        onPress: () => {
          if (songIndex >= 0) onRemoveItem(songIndex);
        },
      });
    }
    return items;
  }, [actionSong, queue, currentItemIndex, addToQueue, playNextInQueue, onRemoveItem, onRequestNavigate]);

  // 队列面板主体（modal/sheet 两形态共用）：标题行 + 虚拟化列表
  const renderPanel = (sheetMode: boolean) => (
    <Pressable
      onPress={() => undefined}
      style={
        sheetMode
          ? [styles.sheetContent, { backgroundColor: palette.background }]
          : [styles.content, { backgroundColor: palette.background, borderColor: palette.border }]
      }
    >
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: palette.text }]}>{queueModel.title}</Text>
          <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
            {queueModel.summary}
          </Text>
        </View>
        <View style={styles.actions}>
          <Touchable
            style={[
              styles.clearButton,
              { backgroundColor: palette.surface },
              !queueModel.management.canClearQueue && styles.clearButtonDisabled,
            ]}
            onPress={onClear}
            disabled={!queueModel.management.canClearQueue}
            accessibilityRole="button"
            accessibilityLabel={queueModel.management.clearLabel}
          >
            <Text style={[styles.clearText, { color: palette.danger }]}>
              {queueModel.management.clearLabel}
            </Text>
          </Touchable>
          <Touchable
            style={[styles.closeButton, { backgroundColor: palette.surface }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={queueModel.closeLabel}
          >
            <Text style={[styles.closeText, { color: palette.textMuted }]}>{queueModel.closeLabel}</Text>
          </Touchable>
        </View>
      </View>
      <FlatList
        ref={listRef}
        data={queue}
        keyExtractor={(_item, index) => `${index}`}
        style={[styles.list, sheetMode ? { height: Math.round(windowHeight * QUEUE_SHEET_HEIGHT_RATIO) - 60 } : undefined]}
        contentContainerStyle={styles.listContent}
        getItemLayout={(_data, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        renderItem={({ item, index }) => (
          <SongItem
            song={item}
            index={index}
            onRowPress={(_song, index) => onPlayItem(index)}
            isPlaying={queueModel.items[index]?.isCurrent ?? false}
            showCover
            showDuration
            hideSourceTag
            showLikeAction
            showMoreAction
            onOpenMenu={handleRowMenu}
          />
        )}
      />
    </Pressable>
  );

  // sheet 形态（全屏播放页）：应用内底部弹层，与子弹窗（Modal）不再嵌套
  if (presentation === "sheet") {
    return (
      <>
        <BottomSheet visible={visible} onClose={onClose} palette={palette} maxHeightRatio={QUEUE_SHEET_HEIGHT_RATIO}>
          {renderPanel(true)}
        </BottomSheet>

        <ActionMenuSheet
          visible={menuVisible}
          title={actionSong?.name ?? ""}
          items={menuItems}
          anchor={menuAnchor}
          onClose={() => {
            setMenuVisible(false);
            setMenuAnchor(null);
            setSubSheetOpen(false);
          }}
        />
        {actionSong ? (
          <AddToLocalPlaylistModal
            visible={addToPlaylistVisible}
            song={actionSong}
            onClose={() => {
              setAddToPlaylistVisible(false);
              setSubSheetOpen(false);
            }}
          />
        ) : null}
        <DownloadQualityModal
          visible={downloadVisible}
          song={actionSong}
          pendingQuality={pendingQuality}
          defaultQuality={defaultQuality}
          onClose={() => {
            if (!downloading) {
              setDownloadVisible(false);
              setSubSheetOpen(false);
            }
          }}
          onDownload={handleDownloadSelected}
        />
      </>
    );
  }

  return (
    <>
      <Modal
        visible={visible && !subSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <TouchableWithoutFeedback accessibilityRole="button" accessibilityLabel="关闭播放列表" onPress={onClose}>
          <View style={styles.overlay}>
            {renderPanel(false)}
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <ActionMenuSheet
        visible={menuVisible}
        title={actionSong?.name ?? ""}
        items={menuItems}
        anchor={menuAnchor}
        onClose={() => {
          setMenuVisible(false);
          setMenuAnchor(null);
          setSubSheetOpen(false);
        }}
      />
      {actionSong ? (
        <AddToLocalPlaylistModal
          visible={addToPlaylistVisible}
          song={actionSong}
          onClose={() => {
            setAddToPlaylistVisible(false);
            setSubSheetOpen(false);
          }}
        />
      ) : null}
      <DownloadQualityModal
        visible={downloadVisible}
        song={actionSong}
        pendingQuality={pendingQuality}
        defaultQuality={defaultQuality}
        onClose={() => {
          if (!downloading) {
            setDownloadVisible(false);
            setSubSheetOpen(false);
          }
        }}
        onDownload={handleDownloadSelected}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    padding: 24,
  },
  content: {
    maxHeight: "78%",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  sheetContent: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 12,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    marginTop: 2,
    fontSize: 12,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  clearButtonDisabled: {
    opacity: 0.5,
  },
  clearText: {
    fontSize: 13,
    fontWeight: "600",
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeText: {
    fontSize: 13,
    fontWeight: "600",
  },
  list: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  listContent: {
    paddingBottom: 4,
  },
});
