import React, { useCallback, useMemo, useRef } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MusicInfo } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import type { ImmersiveQueuePanelModel } from "@/services/playerQueueModel";
import { usePlayerStore } from "@/stores/playerStore";
import { DraggableQueueList, type QueueListHandle } from "@/components/queue/DraggableQueueList";
import { QUEUE_ROW_HEIGHT } from "@/services/queueReorderModel";
import { BottomSheet } from "@/components/BottomSheet";
import { Touchable } from "@/components/Touchable";
import { sheet } from "@/theme/sheetTokens";
import { spacing, touch } from "@/theme/tokens";

/** 面板高度占窗口比例 */
const QUEUE_SHEET_HEIGHT_RATIO = 0.72;
const QUEUE_TITLE_ROW_HEIGHT = 48;
const QUEUE_SUMMARY_HEIGHT = 36;
const QUEUE_FOOTER_HEIGHT = 32;

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
  const insets = useSafeAreaInsets();
  const footerHeight = queue.length > 1 ? QUEUE_FOOTER_HEIGHT : 0;
  const panelChromeHeight = sheet.handlePaddingVertical * 2 + sheet.handleHeight
    + QUEUE_TITLE_ROW_HEIGHT + QUEUE_SUMMARY_HEIGHT + footerHeight;
  const listHeight = Math.max(0, Math.min(queue.length * QUEUE_ROW_HEIGHT,
    Math.floor(windowHeight * QUEUE_SHEET_HEIGHT_RATIO) - panelChromeHeight
      - Math.max(insets.bottom, spacing.m) - StyleSheet.hairlineWidth));

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

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      palette={palette}
      maxHeightRatio={QUEUE_SHEET_HEIGHT_RATIO}
      animated={false}
    >
      <View style={[styles.sheetContent, { backgroundColor: palette.surface }]}>
        <View style={styles.handleContainer} accessible={false}>
          <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
        </View>
        <View style={styles.header}>
          <View style={styles.titleWrap}>
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {queueModel.title}
            </Text>
            <View style={[styles.countBadge, { backgroundColor: palette.surfaceMuted }]}>
              <Text style={[styles.countText, { color: palette.textMuted }]} maxFontSizeMultiplier={1.3}>
                {queue.length}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Touchable
              style={[
                styles.clearButton,
                !queueModel.management.canClearQueue && styles.clearButtonDisabled,
              ]}
              onPress={() => { listRef.current?.cancelDrag(); onClear(); }}
              disabled={!queueModel.management.canClearQueue}
              accessibilityRole="button"
              accessibilityLabel={queueModel.management.clearLabel}
            >
              <Text style={[styles.clearText, { color: palette.dangerInk }]} maxFontSizeMultiplier={1.3}>
                {queueModel.management.clearLabel}
              </Text>
            </Touchable>
            <Touchable
              style={styles.closeButton}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel={queueModel.closeLabel}
            >
              <View style={[styles.closeIcon, { backgroundColor: palette.surfaceMuted }]}>
                <X size={18} color={palette.textMuted} strokeWidth={1.6} />
              </View>
            </Touchable>
          </View>
        </View>
        <View style={[styles.summaryRow, { borderBottomColor: palette.border }]}>
          <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {queueModel.summary}
          </Text>
        </View>
        {visible ? (
          <DraggableQueueList ref={listRef} queue={queue} currentIndex={currentItemIndex} palette={palette}
            height={listHeight}
            enabled onPlayItem={onPlayItem} onRemoveItem={onRemoveItem} />
        ) : null}
        {queue.length > 1 ? (
          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: palette.textSubtle }]} maxFontSizeMultiplier={1.3}>
              长按拖动排序
            </Text>
          </View>
        ) : null}
      </View>
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
  handleContainer: {
    alignItems: "center",
    paddingVertical: sheet.handlePaddingVertical,
  },
  sheetHandle: {
    width: sheet.handleWidth,
    height: sheet.handleHeight,
    borderRadius: sheet.handleRadius,
  },
  header: {
    height: QUEUE_TITLE_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.l,
    gap: spacing.xs,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  title: {
    flexShrink: 1,
    fontSize: 22,
    fontWeight: "700",
  },
  countBadge: {
    minWidth: 28,
    height: 24,
    paddingHorizontal: spacing.xs,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: 12, fontVariant: ["tabular-nums"] },
  summaryRow: {
    height: QUEUE_SUMMARY_HEIGHT,
    marginHorizontal: spacing.l,
    paddingBottom: spacing.s,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: {
    fontSize: 12,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  clearButton: {
    minWidth: touch.minTarget,
    height: touch.minTarget,
    justifyContent: "center",
    alignItems: "center",
  },
  clearButtonDisabled: {
    opacity: 0.42,
  },
  clearText: {
    fontSize: 13,
    fontWeight: "500",
  },
  closeButton: {
    width: touch.minTarget,
    height: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    height: QUEUE_FOOTER_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  footerText: { fontSize: 11 },
});
