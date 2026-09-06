import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { withAlpha } from "@/services/themePaletteModel";

interface ProgressBarProps {
  position: number;
  duration: number;
  buffered?: number;
  onSeek: (position: number) => void;
}

export function ProgressBar({ position, duration, buffered, onSeek }: ProgressBarProps) {
  const [seeking, setSeeking] = useState(false);
  const [seekPosition, setSeekPosition] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);

  const current = seeking ? seekPosition : position;
  const progress = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;
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
    const listenerId = progressAnim.addListener(({ value }) => {
      progressRef.current = value;
    });
    return () => progressAnim.removeListener(listenerId);
  }, [progressAnim]);

  useEffect(() => {
    if (seeking) {
      // 按点选位置即时跟随，不走动画追赶
      progressAnim.setValue(progress);
      return;
    }
    // seek/切歌跳变用 200ms 快速追赶，正常播放用 1000ms 平滑推进（对齐 MiniProgressBar）
    const isJump = Math.abs(progress - progressRef.current) > 0.05;
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: isJump ? 200 : 1000,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [progress, seeking, progressAnim]);

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

  const handlePress = (event: GestureResponderEvent) => {
    // 触点 X 坐标在 nativeEvent 上；宽度用 onLayout 实测值，避免误取导致 NaN 传入 seekTo。
    const locationX = event.nativeEvent.locationX;
    if (trackWidth <= 0 || duration <= 0 || !Number.isFinite(locationX)) return;
    const newProgress = Math.max(0, Math.min(1, locationX / trackWidth));
    const newPosition = newProgress * duration;
    if (!Number.isFinite(newPosition)) return;

    onSeek(newPosition);
  };

  return (
    <Pressable
      style={styles.container}
      onPress={handlePress}
      onLayout={handleLayout}
      onPressIn={() => {
        setSeeking(true);
        setSeekPosition(position);
      }}
      onPressOut={() => setSeeking(false)}
    >
      <View style={[styles.track, { backgroundColor: palette.surfaceStrong }]}>
        {bufferedProgress !== undefined ? (
          <View
            style={[
              styles.fill,
              {
                width: `${bufferedProgress * 100}%`,
                backgroundColor: withAlpha(palette.primary, 0.25),
              },
            ]}
          />
        ) : null}
        <Animated.View
          style={[
            styles.fill,
            styles.progressFill,
            {
              backgroundColor: palette.primary,
              transform: [{ scaleX: progressAnim }],
              transformOrigin: "left",
            },
          ]}
        />
        <Animated.View
          style={[
            styles.thumb,
            {
              backgroundColor: palette.primary,
              transform: [{ translateX: thumbTranslateX }],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  track: {
    height: 4,
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
    top: -4,
    left: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
