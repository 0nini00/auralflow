import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, AppState, FlatList, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, scrollTo, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import type { MusicInfo } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import { usePlayerStore } from "@/stores/playerStore";
import { SongItem } from "@/components/SongList";
import type { ActionMenuAnchor } from "@/components/ActionMenuSheet";
import { hapticLight } from "@/services/hapticService";
import { buildQueueEntries, createQueueDragSession, getQueueAutoScrollOffset, getQueueDropIndex, getQueueRowOffset, moveQueueItem, QUEUE_ROW_HEIGHT, QUEUE_DRAG_HANDLE_WIDTH, resolveQueueRowPresentation, type QueueEntry } from "@/services/queueReorderModel";

const LONG_PRESS_MS = 350;
const GAP_ANIMATION_MS = 120;

export interface QueueListHandle { cancelDrag: () => void }
interface Props {
  queue: MusicInfo[];
  currentIndex: number;
  palette: ThemePalette;
  height: number;
  enabled: boolean;
  onPlayItem: (index: number) => void;
  onOpenMenu: (song: MusicInfo, index: number, anchor: ActionMenuAnchor) => void;
}

const QueueRow = memo(function QueueRow({ index, from, to, children }: {
  index: number; from: SharedValue<number>; to: SharedValue<number>; children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: from.value === index ? 0 : 1,
    // 落位时数据本身已重排，不再把旧的插入间隙动画叠加到新槽位。
    transform: [{ translateY: from.value < 0 ? 0 : withTiming(getQueueRowOffset(index, from.value, to.value), { duration: GAP_ANIMATION_MS }) }],
  }));
  return <Animated.View style={[styles.row, style]}>{children}</Animated.View>;
});

/** 手势挂在列表宿主而非虚拟化行上，拖出渲染窗口时不会丢失手势。 */
export const DraggableQueueList = forwardRef<QueueListHandle, Props>(function DraggableQueueList({
  queue, currentIndex, palette, height, enabled, onPlayItem, onOpenMenu,
}, ref) {
  const listRef = useAnimatedRef<FlatList<QueueEntry>>();
  const count = queue.length;
  const [viewportWidth, setViewportWidth] = useState(0);
  const presentation = resolveQueueRowPresentation(viewportWidth);
  /**
   * 打开队列时把当前曲放到列表中间，而不是贴在上沿（用户还得自己往下找）：
   * 初始定位往前让出半个视口的行数，右侧那行就落在中间。
   */
  const centeredLeadRows = Math.max(0, Math.floor((height / QUEUE_ROW_HEIGHT - 1) / 2));
  const hasCurrentTrack = currentIndex >= 0 && currentIndex < count;
  const initialRowIndex = hasCurrentTrack ? Math.max(0, currentIndex - centeredLeadRows) : undefined;
  const [entryState, setEntryState] = useState(() => ({ queue, entries: buildQueueEntries(queue) }));
  if (entryState.queue !== queue) {
    setEntryState({ queue, entries: buildQueueEntries(queue, entryState.entries) });
  }
  const entries = entryState.entries;
  const [lifted, setLifted] = useState<QueueEntry | null>(null);
  const mounted = useRef(false);
  const dragFrom = useRef(-1);
  const session = useMemo(() => createQueueDragSession((baseline, from, to) =>
    usePlayerStore.getState().reorderQueue(baseline, from, to)), []);
  const from = useSharedValue(-1);
  const to = useSharedValue(-1);
  const gestureId = useSharedValue(0);
  const active = useSharedValue(false);
  // 初始滚动量必须与 initialScrollIndex 一致，否则长按拖动算出的插入位置会整体偏移
  const scrollOffset = useSharedValue((initialRowIndex ?? 0) * QUEUE_ROW_HEIGHT);
  const startScroll = useSharedValue(0);
  const translation = useSharedValue(0);
  const startTranslation = useSharedValue(0);
  const pointerY = useSharedValue(0);
  const viewportHeight = useSharedValue(height);

  const cancelDrag = useCallback(() => {
    session.cancel();
    gestureId.value += 1;
    active.value = false;
    from.value = -1;
    to.value = -1;
    dragFrom.current = -1;
    setLifted(null);
  }, [session, gestureId, active, from, to]);
  useImperativeHandle(ref, () => ({ cancelDrag }), [cancelDrag]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      gestureId.value += 1;
      session.cancel();
      active.value = false;
      from.value = -1;
    };
  }, [session, gestureId, active, from]);
  useLayoutEffect(() => { cancelDrag(); }, [queue, enabled, height, viewportWidth, cancelDrag]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") cancelDrag();
    });
    return () => subscription.remove();
  }, [cancelDrag]);

  const beginDrag = useCallback((id: number, index: number) => {
    if (!mounted.current || id !== gestureId.value) return;
    if (!enabled || queue !== usePlayerStore.getState().queue) {
      cancelDrag();
      return;
    }
    dragFrom.current = index;
    session.start(id, queue, index);
    setLifted(entries[index]);
    hapticLight();
  }, [enabled, queue, entries, session, gestureId, cancelDrag]);

  const finishDrag = useCallback((id: number, target: number, successful: boolean) => {
    if (!mounted.current || id !== gestureId.value) return;
    const source = dragFrom.current;
    const status = session.finish(id, target, successful);
    if (status === "reordered") {
      setEntryState({ queue: usePlayerStore.getState().queue, entries: moveQueueItem(entries, source, target) });
      hapticLight();
      AccessibilityInfo.announceForAccessibility("已移至第 " + (target + 1) + " 首");
    } else if (status === "stale") {
      AccessibilityInfo.announceForAccessibility("播放列表已更新，本次排序已取消");
    } else if (status === "invalid") {
      Alert.alert("无法排序", "队列索引或播放上下文不一致，本次排序未应用。");
    }
    cancelDrag();
  }, [session, entries, gestureId, cancelDrag]);

  const scrollGesture = useMemo(() => Gesture.Native(), []);
  const dragGesture = useMemo(() => Gesture.Pan()
    .enabled(enabled && count > 1)
    .activateAfterLongPress(LONG_PRESS_MS)
    .maxPointers(1)
    .blocksExternalGesture(scrollGesture)
    .onStart(event => {
      const index = Math.floor((event.y + scrollOffset.value) / QUEUE_ROW_HEIGHT);
      if (index < 0 || index >= count) return;
      gestureId.value += 1;
      from.value = index;
      to.value = index;
      startScroll.value = scrollOffset.value;
      startTranslation.value = event.translationY;
      translation.value = 0;
      pointerY.value = event.y;
      active.value = true;
      runOnJS(beginDrag)(gestureId.value, index);
    })
    .onUpdate(event => {
      if (!active.value) return;
      translation.value = event.translationY - startTranslation.value;
      pointerY.value = event.y;
      to.value = getQueueDropIndex(from.value, translation.value, startScroll.value, scrollOffset.value, count);
    })
    .onFinalize((_event, successful) => {
      if (!active.value) return;
      active.value = false;
      runOnJS(finishDrag)(gestureId.value, to.value, successful);
    }), [enabled, count, scrollGesture, scrollOffset, gestureId, from, to, startScroll, startTranslation, translation, pointerY, active, beginDrag, finishDrag]);

  const onScroll = useAnimatedScrollHandler(event => {
    scrollOffset.value = event.contentOffset.y;
    if (active.value) to.value = getQueueDropIndex(from.value, translation.value, startScroll.value, scrollOffset.value, count);
  });
  useFrameCallback(frame => {
    if (!active.value) return;
    const next = getQueueAutoScrollOffset(pointerY.value, viewportHeight.value, scrollOffset.value,
      count * QUEUE_ROW_HEIGHT, frame.timeSincePreviousFrame ?? 0);
    if (next !== scrollOffset.value) {
      scrollOffset.value = next;
      scrollTo(listRef, 0, next, false);
      to.value = getQueueDropIndex(from.value, translation.value, startScroll.value, next, count);
    }
  });
  // 浮动行锚定手指，自动滚动只改变插入位置，不让浮动行随列表滚走。
  const floatingStyle = useAnimatedStyle(() => ({
    opacity: from.value < 0 ? 0 : 1,
    transform: [{ translateY: from.value * QUEUE_ROW_HEIGHT + translation.value - startScroll.value }, { scale: 1.015 }],
  }));

  const renderSong = (entry: QueueEntry, index: number, floating = false) => (
    <View style={styles.songRow}>
      <View style={styles.song}>
        <SongItem song={entry.song} index={index} onRowPress={(_song, row) => { if (dragFrom.current < 0) onPlayItem(row); }}
          isPlaying={index === currentIndex} showCover={presentation.showCover} showDuration={presentation.showDuration}
          hideSourceTag showLikeAction={presentation.showLikeAction}
          showMoreAction={!floating} onOpenMenu={(song, anchor) => { if (dragFrom.current < 0) onOpenMenu(song, index, anchor); }} />
      </View>
      <View style={styles.handle} accessible accessibilityLabel="长按拖动排序">
        <View style={[styles.gripLine, { backgroundColor: palette.textMuted }]} />
        <View style={[styles.gripLine, { backgroundColor: palette.textMuted }]} />
        <View style={[styles.gripLine, { backgroundColor: palette.textMuted }]} />
      </View>
    </View>
  );

  return (
    <GestureDetector gesture={dragGesture}>
      <Animated.View style={[styles.viewport, { height }]} onLayout={event => {
        viewportHeight.value = event.nativeEvent.layout.height;
        setViewportWidth(event.nativeEvent.layout.width);
      }}>
        <GestureDetector gesture={scrollGesture}>
          <Animated.FlatList ref={listRef} data={entries} keyExtractor={item => String(item.key)}
            renderItem={({ item, index }) => <QueueRow index={index} from={from} to={to}>{renderSong(item, index)}</QueueRow>}
            getItemLayout={(_data, index) => ({ length: QUEUE_ROW_HEIGHT, offset: index * QUEUE_ROW_HEIGHT, index })}
            initialScrollIndex={initialRowIndex}
            onScroll={onScroll} scrollEventThrottle={16} scrollEnabled={!lifted}
            bounces={false} overScrollMode="never" windowSize={7} initialNumToRender={12} maxToRenderPerBatch={12}
            removeClippedSubviews={false} />
        </GestureDetector>
        {lifted ? <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[styles.floating, { backgroundColor: palette.surface, borderColor: palette.border }, floatingStyle]}>
          {renderSong(lifted, dragFrom.current, true)}
        </Animated.View> : null}
        {lifted ? <Text style={[styles.dragHint, { color: palette.text, backgroundColor: palette.surface }]} pointerEvents="none">松手放置，返回取消</Text> : null}
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  viewport: { overflow: "hidden", marginHorizontal: 12 },
  row: { height: QUEUE_ROW_HEIGHT },
  songRow: { height: QUEUE_ROW_HEIGHT, flexDirection: "row", alignItems: "center" },
  song: { flex: 1, minWidth: 0 },
  handle: { width: QUEUE_DRAG_HANDLE_WIDTH, height: 44, justifyContent: "center", alignItems: "center", gap: 3 },
  gripLine: { width: 14, height: 1.5, borderRadius: 1 },
  floating: { position: "absolute", left: 0, right: 0, top: 0, height: QUEUE_ROW_HEIGHT,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, elevation: 6,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  dragHint: { position: "absolute", bottom: 4, alignSelf: "center", fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
});
