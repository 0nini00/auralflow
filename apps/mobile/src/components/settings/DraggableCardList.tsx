import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useSettingsScrollController } from "@/components/settings/SettingsScrollContext";
import { hapticLight, hapticWarning } from "@/services/hapticService";
import {
  findSourceRowAt,
  getSourceAutoScrollOffset,
  getSourceDropIndex,
  getSourceRowShift,
  type ReorderLayout,
} from "@/services/sourceReorderModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius } from "@/theme/tokens";

const LONG_PRESS_MS = 320;
const SHIFT_MS = 140;

export interface DraggableCardListProps<T> {
  items: readonly T[];
  /** 卡片间距，必须与容器 gap 一致，否则让位会错位 */
  gap: number;
  keyExtractor: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  onReorder: (from: number, to: number) => void;
}

interface DraggableRowProps {
  index: number;
  from: SharedValue<number>;
  to: SharedValue<number>;
  layouts: SharedValue<ReorderLayout[]>;
  gap: number;
  hidden: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
  children: React.ReactNode;
}

function DraggableRow({
  index,
  from,
  to,
  layouts,
  gap,
  hidden,
  onLayout,
  children,
}: DraggableRowProps) {
  const style = useAnimatedStyle(() => {
    // 落位时数据本身已重排，直接归零，不再把旧的让位位移动画叠到新槽位上
    const translateY = from.value < 0
      ? 0
      : withTiming(
        getSourceRowShift(index, from.value, to.value, layouts.value, gap),
        { duration: SHIFT_MS },
      );
    return {
      opacity: hidden ? 0 : 1,
      transform: [{ translateY }],
    };
  }, [hidden, index, gap]);

  return (
    <Animated.View style={style} onLayout={onLayout}>
      {children}
    </Animated.View>
  );
}

/**
 * 卡片拖拽排序列表（卡片高度可不等）。
 *
 * 交互：长按 320ms 抬起卡片 → 上下拖动换位 → 松手落库；拖到视口上下边缘自动滚页。
 * 手势挂在列表宿主而非单张卡片上，卡片内的按钮/开关被按下时不会提前抢走手势。
 */
export function DraggableCardList<T>({
  items,
  gap,
  keyExtractor,
  renderItem,
  onReorder,
}: DraggableCardListProps<T>) {
  const controller = useSettingsScrollController();
  // 不在设置页内使用时也要满足 hooks 顺序：给一份本地兜底，只是没有页面滚动联动
  const localScrollOffset = useSharedValue(0);
  const localMetrics = useSharedValue({ top: 0, height: 0, contentHeight: 0 });
  const scrollOffset = controller?.scrollOffset ?? localScrollOffset;
  const metrics = controller?.metrics ?? localMetrics;

  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const [liftedIndex, setLiftedIndex] = useState<number | null>(null);
  const layoutsRef = useRef<ReorderLayout[]>([]);
  const layouts = useSharedValue<ReorderLayout[]>([]);

  const from = useSharedValue(-1);
  const to = useSharedValue(-1);
  const active = useSharedValue(false);
  const gestureId = useSharedValue(0);
  const fingerTranslation = useSharedValue(0);
  const startTranslation = useSharedValue(0);
  const startScroll = useSharedValue(0);
  const dragScroll = useSharedValue(0);
  const pointerY = useSharedValue(0);

  // 删除音源后旧的尾部布局要裁掉，否则落位会算到不存在的槽位
  useEffect(() => {
    if (layoutsRef.current.length <= items.length) return;
    const next = layoutsRef.current.slice(0, items.length);
    layoutsRef.current = next;
    layouts.value = next;
  }, [items.length, layouts]);

  const beginDrag = useCallback((id: number, index: number) => {
    if (id !== gestureId.value) return;
    controller?.lock(true);
    setLiftedIndex(index);
    hapticLight();
  }, [controller, gestureId]);

  const scrollPage = useCallback((y: number) => {
    controller?.scrollTo(y);
  }, [controller]);

  const finishDrag = useCallback(
    (id: number, source: number, target: number, successful: boolean) => {
      if (id !== gestureId.value) return;
      gestureId.value += 1;
      controller?.lock(false);
      setLiftedIndex(null);
      if (!successful || source < 0 || target < 0 || source === target) return;
      onReorder(source, target);
      hapticWarning();
      AccessibilityInfo.announceForAccessibility(`已移到第 ${target + 1} 位`);
    },
    [controller, gestureId, onReorder],
  );

  const cancelDrag = useCallback(() => {
    gestureId.value += 1;
    active.value = false;
    from.value = -1;
    to.value = -1;
    controller?.lock(false);
    setLiftedIndex(null);
  }, [active, controller, from, gestureId, to]);

  // 拖拽中离开设置页：必须解锁，否则返回后页面滚不动
  useEffect(() => () => {
    controller?.lock(false);
  }, [controller]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") cancelDrag();
    });
    return () => subscription.remove();
  }, [cancelDrag]);

  const handleRowLayout = useCallback((index: number, event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const previous = layoutsRef.current[index];
    if (previous && previous.y === y && previous.height === height) return;
    const next = layoutsRef.current.slice();
    next[index] = { y, height };
    layoutsRef.current = next;
    layouts.value = next;
  }, [layouts]);

  const dragGesture = useMemo(
    () => Gesture.Pan()
      .enabled(items.length > 1)
      .activateAfterLongPress(LONG_PRESS_MS)
      .maxPointers(1)
      .onStart((event) => {
        const index = findSourceRowAt(layouts.value, event.y);
        if (index < 0) return;
        gestureId.value += 1;
        from.value = index;
        to.value = index;
        active.value = true;
        startTranslation.value = event.translationY;
        fingerTranslation.value = 0;
        startScroll.value = scrollOffset.value;
        dragScroll.value = scrollOffset.value;
        pointerY.value = event.absoluteY;
        runOnJS(beginDrag)(gestureId.value, index);
      })
      .onUpdate((event) => {
        if (!active.value) return;
        fingerTranslation.value = event.translationY - startTranslation.value;
        pointerY.value = event.absoluteY;
        to.value = getSourceDropIndex(
          layouts.value,
          from.value,
          fingerTranslation.value + (dragScroll.value - startScroll.value),
        );
      })
      .onFinalize((_event, successful) => {
        if (!active.value) return;
        active.value = false;
        const source = from.value;
        const target = to.value;
        from.value = -1;
        to.value = -1;
        runOnJS(finishDrag)(gestureId.value, source, target, successful);
      }),
    [
      items.length,
      layouts,
      gestureId,
      from,
      to,
      active,
      startTranslation,
      fingerTranslation,
      startScroll,
      dragScroll,
      pointerY,
      scrollOffset,
      beginDrag,
      finishDrag,
    ],
  );

  useFrameCallback((frame) => {
    if (!active.value) return;
    const viewport = metrics.value;
    if (viewport.height <= 0 || viewport.contentHeight <= 0) return;
    const next = getSourceAutoScrollOffset(
      pointerY.value - viewport.top,
      viewport.height,
      dragScroll.value,
      viewport.contentHeight,
      frame.timeSincePreviousFrame ?? 0,
    );
    if (next === dragScroll.value) return;
    dragScroll.value = next;
    runOnJS(scrollPage)(next);
    to.value = getSourceDropIndex(
      layouts.value,
      from.value,
      fingerTranslation.value + (next - startScroll.value),
    );
  });

  // 浮动卡片锚定手指：页面自动滚动时用滚动增量补偿，卡片不会被列表带走
  const floatingStyle = useAnimatedStyle(() => {
    const row = from.value >= 0 ? layouts.value[from.value] : undefined;
    if (!row) {
      return { opacity: 0, transform: [{ translateY: 0 }, { scale: 1 }] };
    }
    const translateY = row.y + fingerTranslation.value + (dragScroll.value - startScroll.value);
    return { opacity: 1, transform: [{ translateY }, { scale: 1.02 }] };
  });

  return (
    <GestureDetector gesture={dragGesture}>
      <View style={[styles.container, { gap }]}>
        {items.map((item, index) => (
          <DraggableRow
            key={keyExtractor(item)}
            index={index}
            from={from}
            to={to}
            layouts={layouts}
            gap={gap}
            hidden={liftedIndex === index}
            onLayout={(event) => handleRowLayout(index, event)}
          >
            {renderItem(item, index)}
          </DraggableRow>
        ))}
        {liftedIndex !== null && items[liftedIndex] !== undefined ? (
          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.floating,
              { backgroundColor: palette.surface, borderColor: palette.border },
              floatingStyle,
            ]}
          >
            {renderItem(items[liftedIndex], liftedIndex)}
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
  },
  floating: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
    elevation: 10,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
  },
});
