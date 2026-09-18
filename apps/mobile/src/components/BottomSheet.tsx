import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { ThemePalette } from "@/stores/themeStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
  /** 面板最大高度占窗口高度比例（默认 0.72） */
  maxHeightRatio?: number;
  children: React.ReactNode;
  /** 是否启用滑入/滑出过渡动画，默认为 false（瞬间弹出与收起） */
  animated?: boolean;
}

/**
 * 应用内底部弹层（非 RN Modal）：
 * - 挂在当前屏幕根容器内的 absolute 覆盖层，没有 RN Modal 的原生窗口门槛与
 *   焦点切换开销，连续开合不再"肉"；也不存在与外层 Modal 嵌套的白屏问题。
 * - reanimated shared value 驱动滑入/滑出，宿主 visible 置 false 时先播退场
 *   动画再卸载内容（对齐原生 Modal 的观感语义）。
 * - 注意：宿主容器必须是铺满整屏的根容器（否则覆盖层会被裁剪到小容器内）。
 */
export function BottomSheet({
  visible,
  onClose,
  palette,
  maxHeightRatio = 0.72,
  children,
  animated = false,
}: BottomSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);
  // 最新 visible 的 ref:退场动画回调里判断是否仍处于关闭态,避免快速重开时
  // 退场回调把已重新打开的 sheet 误卸载(visible 已翻 true 但旧退场动画仍在飞)。
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (!animated) {
      progress.value = visible ? 1 : 0;
      setMounted(visible);
      return;
    }
    if (visible) {
      // 每次进入都从隐藏位(progress=0)干净起动画:若上一次退场动画被打断,
      // progress 停在中间值,不重置直接 spring(1) 会表现为「先出现在中间再滑到底」。
      progress.value = 0;
      setMounted(true);
      progress.value = withSpring(1, { stiffness: 320, damping: 32 });
      return;
    }
    if (!mounted) return;
    // visible 已翻 false:先播退场动画,结束后卸载内容(若期间重新打开则放弃卸载)
    progress.value = withTiming(
      0,
      { duration: 200, easing: Easing.in(Easing.quad) },
      (finished) => {
        if (finished && !visibleRef.current) runOnJS(setMounted)(false);
      },
    );
  }, [visible, mounted, progress, animated]);

  // 安卓返回键关闭（与 RN Modal onRequestClose 行为一致）
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [visible, onClose]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1]),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          progress.value,
          [0, 1],
          [windowHeight * maxHeightRatio + 24, 0],
        ),
      },
    ],
  }));

  const shouldRender = animated ? mounted : visible;
  if (!shouldRender) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={visible ? "auto" : "none"}
    >
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable
          style={styles.scrimTouch}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="关闭弹层"
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            maxHeight: windowHeight * maxHeightRatio,
            backgroundColor: palette.background,
            borderTopColor: palette.border,
            // 底部安全区避让：列表不被手势条截断（max(安全区, 现有内边距)）
            paddingBottom: Math.max(insets.bottom, 0),
          },
          sheetStyle,
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  scrimTouch: {
    flex: 1,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
