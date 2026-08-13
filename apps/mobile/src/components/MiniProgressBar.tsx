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

  const progress = duration > 0 ? position / duration : 0;
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
    // 与 lx 一致：seek/切歌跳变用 200ms 快速追赶，正常播放用 1000ms 平滑推进
    const isJump = Math.abs(progress - progressRef.current) > 0.05;

    Animated.timing(progressAnim, {
      toValue: progress,
      duration: isJump ? 200 : 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [progress, progressAnim]);

  const animatedWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

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
        style={[styles.progress, { width: animatedWidth, backgroundColor: palette.primary }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 2,
  },
  progress: {
    height: "100%",
  },
});
