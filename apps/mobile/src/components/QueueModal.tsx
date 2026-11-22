import React, { useCallback, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { MusicInfo } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import type { ImmersiveQueuePanelModel } from "@/services/playerQueueModel";
import { usePlayerStore } from "@/stores/playerStore";
import { DraggableQueueList, type QueueListHandle } from "@/components/queue/DraggableQueueList";
import { QUEUE_ROW_HEIGHT } from "@/services/queueReorderModel";
import { BottomSheet } from "@/components/BottomSheet";
import { Touchable } from "@/components/Touchable";
import { sheet } from "@/theme/sheetTokens";

/** 面板高度占窗口比例 */
const QUEUE_SHEET_HEIGHT_RATIO = 0.72;
const QUEUE_PANEL_CHROME_HEIGHT = 100;

export interface QueueModalProps {
  visible: boolean;
  queueModel: ImmersiveQueuePanelModel;
  /** 完整播放队列（用于渲染可拖动行） */
  queue: MusicInfo[];
  palette: ThemePalette;
  onClose: () => void;
  onPlayItem: (index: number) => void;
  onRemoveItem: (index: number) => void;
  onClear: () => void;
}

/**
 * 播放队列面板，由全屏播放器（ImmersiveModals）使用。
 *
 * 行内只保留删除按钮，其余操作统一放在播放页底部辅助行；
 * 不再为每行挂「更多」菜单，避免与播放控制区重复。
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
}: QueueModalProps) {
  const listRef = useRef<QueueListHandle>(null);
  const { height: windowHeight } = useWindowDimensions();

  const handleClose = useCallback(() => {
    listRef.current?.cancelDrag();
    onClose();
  }, [onClose]);

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
        {visible ? (
          <DraggableQueueList ref={listRef} queue={queue} currentIndex={currentItemIndex} palette={palette}
            height={Math.max(QUEUE_ROW_HEIGHT, Math.min(queue.length * QUEUE_ROW_HEIGHT,
              Math.round(windowHeight * QUEUE_SHEET_HEIGHT_RATIO) - QUEUE_PANEL_CHROME_HEIGHT))}
            enabled onPlayItem={onPlayItem} onRemoveItem={onRemoveItem} />
        ) : null}
      </Pressable>
    );
    // 面板不叠手势根：沉浸屏本身已是 GestureHandlerRootView 的子节点。
    return <View style={containerStyle}>{content}</View>;
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      palette={palette}
      maxHeightRatio={QUEUE_SHEET_HEIGHT_RATIO}
      animated={false}
    >
      {renderPanel()}
    </BottomSheet>
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
    opacity: 0.42,
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
  },
});
