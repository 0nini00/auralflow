import React, { useCallback, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableWithoutFeedback, View, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
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
import { DraggableQueueList, type QueueListHandle } from "@/components/queue/DraggableQueueList";
import { QUEUE_ROW_HEIGHT } from "@/services/queueReorderModel";
import { ActionMenuSheet, type ActionMenuAnchor, type ActionMenuItem } from "@/components/ActionMenuSheet";
import { AddToLocalPlaylistModal } from "@/components/AddToLocalPlaylistModal";
import { DownloadQualityModal } from "@/components/DownloadQualityModal";
import { BottomSheet } from "@/components/BottomSheet";
import { Touchable } from "@/components/Touchable";

/** sheet 形态的面板高度占窗口比例（对齐 lx PlayerPlaylist 的比例式高度） */
const QUEUE_SHEET_HEIGHT_RATIO = 0.72;
const QUEUE_CARD_HEIGHT_RATIO = 0.65;
const QUEUE_PANEL_CHROME_HEIGHT = 100;

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
  /**
   * sheet 形态的宿主（仅 presentation="sheet" 时生效）：
   * - "overlay"（默认）：BottomSheet 直接挂载为应用内覆盖层。用于已处于 RN Modal
   *   内的全屏播放页（沉浸屏），避免与子弹窗构成嵌套 Modal。
   * - "modal"：在 BottomSheet 外包一层全屏透明 RN Modal 作为宿主。用于宿主容器
   *   不满屏的迷你播放栏，让弹层获得整屏空间，观感/动画与沉浸屏一致；PlayerBar
   *   不在沉浸 Modal 内，故无嵌套 Modal 问题。
   */
  sheetHost?: "overlay" | "modal";
}

/**
 * 播放队列面板（对齐 lx PlayerPlaylist）。
 *
 * 行样式复用 SongItem（lx 风格：封面/歌名/歌手·专辑/时长/喜欢/更多），
 * 更多菜单含队列专属的「从队列移除」。
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
  sheetHost = "overlay",
}: QueueModalProps) {
  const listRef = useRef<QueueListHandle>(null);
  const { height: windowHeight } = useWindowDimensions();
  const playNextInQueue = usePlayerStore((state) => state.playNextInQueue);
  const downloadSong = useDownloadStore((state) => state.downloadSong);

  // 单例弹窗
  const [actionSong, setActionSong] = useState<MusicInfo | null>(null);
  const [actionSlot, setActionSlot] = useState<{ queue: MusicInfo[]; index: number } | null>(null);
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

  const handleClose = useCallback(() => {
    listRef.current?.cancelDrag();
    onClose();
  }, [onClose]);

  const openQueueMenu = (song: MusicInfo, index: number, anchor: ActionMenuAnchor) => {
    listRef.current?.cancelDrag();
    setActionSong(song);
    // 槽位而非歌曲 ID：重复歌曲不能误删首个匹配项，队列更新后旧菜单不再允许移除。
    setActionSlot({ queue, index });
    setMenuAnchor(anchor);
    setMenuVisible(true);
  };

  // 当前播放曲在队列中的索引(支持播放中与暂停态精准解析)
  const currentSong = usePlayerStore((state) => state.currentSong);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const currentItemIndex = useMemo(() => {
    const fromModel = queueModel.items.findIndex((item) => item.isCurrent);
    if (fromModel >= 0) return fromModel;
    if (currentIndex >= 0 && currentIndex < queue.length) return currentIndex;
    if (currentSong) {
      const idx = queue.findIndex(
        (item) => item.source === currentSong.source && String(item.id) === String(currentSong.id),
      );
      if (idx >= 0) return idx;
    }
    return -1;
  }, [queueModel.items, currentIndex, queue, currentSong]);

  const menuItems: ActionMenuItem[] = useMemo(() => {
    if (!actionSong) return [];
    const song = actionSong;
    const songIndex = actionSlot?.queue === queue ? actionSlot.index : -1;
    const items: ActionMenuItem[] = [
      { label: "下一首播放", icon: "playNext", onPress: () => playNextInQueue(song) },
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
    if (songIndex >= 0 && songIndex !== currentItemIndex) {
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
  }, [actionSong, actionSlot, queue, currentItemIndex, playNextInQueue, onRemoveItem, onRequestNavigate]);

  // 队列面板主体（modal/sheet 两形态共用）：标题行 + 虚拟化列表
  const renderPanel = (sheetMode: boolean) => (
    <GestureHandlerRootView unstable_forceActive
      style={
        sheetMode
          ? [styles.sheetContent, { backgroundColor: palette.background }]
          : [styles.content, { backgroundColor: palette.background, borderColor: palette.border }]
      }
    >
      <Pressable onPress={() => undefined}>
        <View style={styles.header}>
          <View style={styles.titleWrap}>
            <Text style={[styles.title, { color: palette.text }]}>{queueModel.title}</Text>
            <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
              {queueModel.summary}{queue.length > 1 ? " · 长按拖动排序" : ""}
            </Text>
          </View>
          <View style={styles.actions}>
            <Touchable
              style={[
                styles.clearButton,
                { backgroundColor: palette.surface },
                !queueModel.management.canClearQueue && styles.clearButtonDisabled,
              ]}
              onPress={() => { listRef.current?.cancelDrag(); onClear(); }}
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
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel={queueModel.closeLabel}
            >
              <Text style={[styles.closeText, { color: palette.textMuted }]}>{queueModel.closeLabel}</Text>
            </Touchable>
          </View>
        </View>
        {visible && !subSheetOpen ? (
          <DraggableQueueList ref={listRef} queue={queue} currentIndex={currentItemIndex} palette={palette}
            height={Math.max(QUEUE_ROW_HEIGHT, Math.min(queue.length * QUEUE_ROW_HEIGHT,
              Math.round(windowHeight * (sheetMode ? QUEUE_SHEET_HEIGHT_RATIO : QUEUE_CARD_HEIGHT_RATIO)) - QUEUE_PANEL_CHROME_HEIGHT))}
            enabled={!menuVisible} onPlayItem={onPlayItem} onOpenMenu={openQueueMenu} />
        ) : null}
      </Pressable>
    </GestureHandlerRootView>
  );

  // sheet 形态：应用内底部弹层（BottomSheet），与子弹窗（Modal）不再嵌套
  if (presentation === "sheet") {
    const sheet = (
      <BottomSheet
        visible={visible && !subSheetOpen}
        onClose={handleClose}
        palette={palette}
        maxHeightRatio={QUEUE_SHEET_HEIGHT_RATIO}
        animated={false}
      >
        {renderPanel(true)}
      </BottomSheet>
    );
    return (
      <>
        {sheetHost === "modal" ? (
          // 迷你播放栏宿主容器不满屏：套一层全屏透明 Modal 让 BottomSheet 获得整屏空间，
          // 移除动画，瞬间展示
          <Modal transparent visible={visible} animationType="none" onRequestClose={handleClose}>
            {sheet}
          </Modal>
        ) : (
          // 沉浸屏本身是 RN Modal：直接挂应用内覆盖层，避免嵌套 Modal 白屏
          sheet
        )}

        <ActionMenuSheet
          visible={menuVisible}
          song={actionSong}
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
        animationType="none"
        onRequestClose={handleClose}
      >
        <TouchableWithoutFeedback accessibilityRole="button" accessibilityLabel="关闭播放列表" onPress={handleClose}>
          <View style={styles.overlay}>
            {renderPanel(false)}
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <ActionMenuSheet
        visible={menuVisible}
        song={actionSong}
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
    flex: 0,
    maxHeight: "78%",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  sheetContent: {
    flex: 0,
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
});
