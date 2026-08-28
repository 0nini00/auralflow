import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { usePlayerStore } from "@/stores/playerStore";
import { useThemeStore, getResolvedTheme, getThemePalette } from "@/stores/themeStore";

export function MiniProgressBar() {
  const position = usePlayerStore((state) => state.position);
  const duration = usePlayerStore((state) => state.duration);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const progressAnim = useRef(new Animated.Value(progress)).current;
  // 通过监听器跟踪动画当前值，避免读取私有字段 (progressAnim as any)._value
  const progressRef = useRef(progress);

  useEffect(() => {
    const listenerId = progressAnim.addListener(({ value }) => {
      progressRef.current = value;
    });
    return () => progressAnim.removeListener(listenerId);
  }, [progressAnim]);

  useEffect(() => {
    // 与 lx 一致：seek/切歌跳变用 200ms 快速追赶，正常播放用 1000ms 平滑推进。
    // scaleX + native driver：width 百分比插值的 JS 动画每帧都过 JS 线程，
    // 播放期间常驻 60fps；缩放动画走 UI 线程，JS 只在每个进度 tick 启动一次。
    const isJump = Math.abs(progress - progressRef.current) > 0.05;

    Animated.timing(progressAnim, {
      toValue: progress,
      duration: isJump ? 200 : 1000,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [progress, progressAnim]);

  return (
    <View
      style={[styles.container, { backgroundColor: palette.surfaceMuted }]}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(progress * 100),
      }}
    >
      <Animated.View
        style={[
          styles.progress,
          {
            backgroundColor: palette.primary,
            transform: [{ scaleX: progressAnim }],
            transformOrigin: "left",
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 2,
    overflow: "hidden",
  },
  progress: {
    height: "100%",
    width: "100%",
  },
});
