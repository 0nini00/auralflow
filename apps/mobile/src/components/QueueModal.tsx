import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { MusicInfo } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import type { ImmersiveQueuePanelModel } from "@/services/playerQueueModel";
import {
  shouldPromptDownloadQuality,
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
import { sheet } from "@/theme/sheetTokens";
import { afterModalDismiss } from "@/utils/modalSequence";

/** 面板高度占窗口比例 */
const QUEUE_SHEET_HEIGHT_RATIO = 0.72;
const QUEUE_PANEL_CHROME_HEIGHT = 100;

export interface QueueModalProps {
  visible: boolean;
  queueModel: ImmersiveQueuePanelModel;
  /** 完整播放队列（用于渲染行：封面/时长/喜欢/更多） */
  queue: MusicInfo[];
  palette: ThemePalette;
  onClose: () => void;
  onPlayItem: (index: number) => void;
  onRemoveItem: (index: number) => void;
  onClear: () => void;
  /**
   * 队列菜单内发起路由跳转（如「播放 MV」）前的回调。
   * 播放页整体是 RN Modal（浮于导航栈之上），必须先关闭播放页再压路由，
   * 否则新页面被盖住不可见。
   */
  onRequestNavigate?: () => void;
}

/**
 * 播放队列面板，由全屏播放器（ImmersiveModals）使用。
 *
 * 行样式复用 SongItem（封面/歌名/歌手·专辑/时长/喜欢/更多），
 * 更多菜单含队列专属的「从队列移除」。
 * 以应用内底部弹层（BottomSheet）呈现：沉浸屏本身已在 RN Modal 内，
 * 不能再套一层 Modal 子弹窗（Android 嵌套 Modal 白屏）。
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
}: QueueModalProps) {
  const listRef = useRef<QueueListHandle>(null);
  const { height: windowHeight } = useWindowDimensions();
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
  // 上次选择的下载音质
  const [defaultQuality, setDefaultQuality] = useState<DownloadQuality | null>(null);


  const handleDownloadSelected = async (quality: DownloadQuality) => {
    if (!actionSong || downloading) return;
    setPendingQuality(quality);
    setDownloading(true);
    try {
      // 记住本次选择，下次默认选中
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
    // 云盘曲没有档位可选：直接下载原文件，不弹音质选择。
    if (!shouldPromptDownloadQuality(song)) {
      void (async () => {
        try {
          const result = await downloadSong(song);
          if (result.status === "failed") {
            Alert.alert("下载失败", result.error ?? "下载失败");
          }
        } catch (error) {
          Alert.alert("下载失败", error instanceof Error ? error.message : String(error));
        }
      })();
      return;
    }
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

  // 面板收起时复位子弹窗状态：否则某次子弹窗异常未回调 onClose，
  // 下次打开会因为 subSheetOpen 仍为 true 而只显示一个没有列表的空面板。
  useEffect(() => {
    if (visible) return;
    setMenuVisible(false);
    setMenuAnchor(null);
    setSubSheetOpen(false);
    setAddToPlaylistVisible(false);
    setDownloadVisible(false);
  }, [visible]);

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
      {
        label: "收藏到歌单",
        icon: "playlist",
        onPress: () => {
          setSubSheetOpen(true);
          // 先让队列面板收起来，再挂载收藏弹层：Android 上同一帧挂载会让
          // 新弹层落在仍在关闭的 Dialog 之后，点空白区域没反应。
          afterModalDismiss(() => setAddToPlaylistVisible(true));
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
  }, [actionSong, actionSlot, queue, currentItemIndex, onRemoveItem, onRequestNavigate]);

  // 队列面板主体：标题行 + 虚拟化列表
  const renderPanel = () => {
    // 弹层底色统一走 surface。此前用的是 palette.background（页面底色），
    // 在深色主题下比其它弹层更黑一档，看起来像「另一个 app 的弹窗」。
    const containerStyle = [styles.sheetContent, { backgroundColor: palette.surface }];
    const content = (
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
                { backgroundColor: palette.surfaceMuted },
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
              style={[styles.closeButton, { backgroundColor: palette.surfaceMuted }]}
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
              Math.round(windowHeight * QUEUE_SHEET_HEIGHT_RATIO) - QUEUE_PANEL_CHROME_HEIGHT))}
            enabled={!menuVisible} onPlayItem={onPlayItem} onOpenMenu={openQueueMenu} />
        ) : null}
      </Pressable>
    );
    // 面板不叠手势根：沉浸屏本身已是 GestureHandlerRootView 的子节点。
    return <View style={containerStyle}>{content}</View>;
  };

  const queueSheet = (
    <BottomSheet
      visible={visible && !subSheetOpen}
      onClose={handleClose}
      palette={palette}
      maxHeightRatio={QUEUE_SHEET_HEIGHT_RATIO}
      animated={false}
    >
      {renderPanel()}
    </BottomSheet>
  );

  // 以应用内底部弹层（BottomSheet）呈现，与子弹窗（Modal）不构成嵌套 Modal。
  return (
    <>
      {queueSheet}

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
  sheetContent: {
    flex: 0,
    borderTopLeftRadius: sheet.radius,
    borderTopRightRadius: sheet.radius,
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
