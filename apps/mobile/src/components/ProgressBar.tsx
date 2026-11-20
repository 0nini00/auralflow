import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { withAlpha } from "@/services/themePaletteModel";
import { logger } from "@/services/logger";

interface ProgressBarProps {
  position: number;
  duration: number;
  buffered?: number;
  trackKey?: string;
  onSeek: (position: number) => void | Promise<void>;
  /** 播放页固定深色时传入播放器的 dark palette，避免进度条轨道跟着全局浅色主题发亮 */
  palette?: ReturnType<typeof getThemePalette>;
}

export function ProgressBar({
  position,
  duration,
  buffered,
  trackKey,
  onSeek,
  palette: paletteOverride,
}: ProgressBarProps) {
  const [seeking, setSeeking] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const dragRef = useRef<{ originX: number; duration: number; progress: number; trackKey?: string } | null>(null);
  const pendingSeekRef = useRef<{ position: number; duration: number } | null>(null);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const themePalette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const palette = paletteOverride ?? themePalette;

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const playbackProgressRef = useRef(progress);
  playbackProgressRef.current = progress;
  const bufferedProgress =
    duration > 0 && typeof buffered === "number" && Number.isFinite(buffered)
      ? Math.min(1, buffered / duration)
      : undefined;

  // 与 MiniProgressBar 同款：scaleX + 原生驱动。进度事件 0.25s 一次，
  // width 百分比直写会在沉浸页呈现 4Hz 的台阶感；缩放动画走 UI 线程，
  // JS 只在每个 tick 启动一次动画，视觉上连续推进。
  const progressAnim = useRef(new Animated.Value(progress)).current;
  const progressRef = useRef(progress);

  useEffect(() => {
    if (dragRef.current && (dragRef.current.duration !== duration || dragRef.current.trackKey !== trackKey)) {
      // 曲目/时长变化时旧手势失效，不能把旧坐标提交给新曲目。
      dragRef.current = null;
      pendingSeekRef.current = null;
      setSeeking(false);
      progressAnim.setValue(progress);
      progressRef.current = progress;
      return;
    }
    if (seeking) return;
    const pending = pendingSeekRef.current;
    if (pending && pending.position === position && pending.duration === duration) {
      // 松手后保留预览，等播放层发布新位置再接回正常进度。
      return;
    }
    pendingSeekRef.current = null;
    // seek/切歌跳变用 200ms 快速追赶，正常播放用 1000ms 平滑推进（对齐 MiniProgressBar）
    const isJump = Math.abs(progress - progressRef.current) > 0.05;
    progressRef.current = progress;
    const animation = Animated.timing(progressAnim, {
      toValue: progress,
      duration: isJump ? 200 : 1000,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, position, duration, trackKey, seeking, progressAnim]);

  // 插值节点按 trackWidth 缓存：本组件随进度事件 4Hz 重渲染，
  // 若每次渲染都重建 .interpolate() 会向原生动画层高频注册/丢弃节点
  // （native animated 节点竞态是 Android 闪退的已知来源），必须 memo 化。
  const thumbTranslateX = React.useMemo(
    () =>
      progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, trackWidth],
      }),
    [progressAnim, trackWidth],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const canSeek = trackWidth > 0 && Number.isFinite(duration) && duration > 0;
  const updateDrag = (event: GestureResponderEvent) => {
    const drag = dragRef.current;
    if (!drag || !Number.isFinite(event.nativeEvent.pageX) || trackWidth <= 0) return;
    drag.progress = Math.max(0, Math.min(1, (event.nativeEvent.pageX - drag.originX) / trackWidth));
    progressAnim.setValue(drag.progress);
  };
  const startDrag = (event: GestureResponderEvent) => {
    const { locationX, pageX } = event.nativeEvent;
    if (!canSeek || !Number.isFinite(locationX) || !Number.isFinite(pageX)) return;
    pendingSeekRef.current = null;
    dragRef.current = { originX: pageX - locationX, duration, progress, trackKey };
    progressAnim.stopAnimation();
    setSeeking(true);
    updateDrag(event);
  };
  const releaseDrag = async (event: GestureResponderEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    updateDrag(event);
    dragRef.current = null;
    progressRef.current = drag.progress;
    const request = { position, duration };
    pendingSeekRef.current = request;
    setSeeking(false);
    try {
      await onSeek(drag.progress * drag.duration);
    } catch (error) {
      if (pendingSeekRef.current === request) {
        pendingSeekRef.current = null;
        progressAnim.setValue(playbackProgressRef.current);
        progressRef.current = playbackProgressRef.current;
      }
      logger.warn("[ProgressBar] 跳转播放位置失败", error);
    }
  };
  const cancelDrag = () => {
    dragRef.current = null;
    pendingSeekRef.current = null;
    progressAnim.setValue(progress);
    progressRef.current = progress;
    setSeeking(false);
  };

  return (
    <View
      style={styles.container}
      onLayout={handleLayout}
      onStartShouldSetResponder={() => canSeek}
      onResponderGrant={startDrag}
      onResponderMove={updateDrag}
      onResponderRelease={releaseDrag}
      onResponderTerminate={cancelDrag}
      onResponderTerminationRequest={() => false}
      accessibilityRole="adjustable"
      accessibilityLabel="播放进度"
      accessibilityValue={{ min: 0, max: duration > 0 ? duration : 0, now: position }}
      accessibilityActions={[{ name: "increment", label: "快进5秒" }, { name: "decrement", label: "后退5秒" }]}
      onAccessibilityAction={event => {
        if (!canSeek) return;
        const { actionName } = event.nativeEvent;
        if (actionName === "increment") onSeek(Math.min(duration, position + 5));
        if (actionName === "decrement") onSeek(Math.max(0, position - 5));
      }}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: withAlpha(palette.text, 0.14) }]}>
        {bufferedProgress !== undefined ? (
          <View
            style={[
              styles.fill,
              {
                width: `${bufferedProgress * 100}%`,
                backgroundColor: withAlpha(palette.text, 0.22),
              },
            ]}
          />
        ) : null}
        <Animated.View
          style={[
            styles.fill,
            styles.progressFill,
            {
              backgroundColor: withAlpha(palette.primary, 0.7),
              transform: [{ scaleX: progressAnim }],
              transformOrigin: "left",
            },
          ]}
        />
        <Animated.View
          style={[
            styles.thumb,
            {
              backgroundColor: palette.primaryInk,
              transform: [{ translateX: thumbTranslateX }],
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  track: {
    height: 3,
    borderRadius: 2,
    position: "relative",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    borderRadius: 2,
  },
  // 播放进度填充固定满宽，由 scaleX 控制实际长度（缩放动画走 UI 线程）
  progressFill: {
    width: "100%",
  },
  thumb: {
    position: "absolute",
    top: -2.5,
    left: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
