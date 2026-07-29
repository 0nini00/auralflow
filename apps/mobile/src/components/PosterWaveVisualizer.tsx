import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

/**
 * 底部律动可视化条。桌面端用 SVG 双层波浪加 mask 遮罩显示播放进度；
 * RN 未装 react-native-svg，用一排竖条模拟 EQ 律动条，
 * 播放时循环起伏，暂停时静止，进度前部分用 accent 高亮。
 */
export interface PosterWaveVisualizerProps {
  isPlaying: boolean;
  /** 0 ~ 100，用于把前 progressPercent% 的竖条染成 accent 色 */
  progressPercent: number;
  accentColor: string;
  baselineColor: string;
  barCount?: number;
  height?: number;
}

const DEFAULT_BAR_COUNT = 40;
const DEFAULT_HEIGHT = 46;

export function PosterWaveVisualizer({
  isPlaying,
  progressPercent,
  accentColor,
  baselineColor,
  barCount = DEFAULT_BAR_COUNT,
  height = DEFAULT_HEIGHT,
}: PosterWaveVisualizerProps) {
  // 每根竖条一个独立 Animated.Value，随机相位循环起伏
  const anims = useMemo(
    () => Array.from({ length: barCount }, () => new Animated.Value(Math.random())),
    [barCount],
  );
  const seeds = useMemo(
    () => Array.from({ length: barCount }, (_, i) => 0.45 + 0.45 * ((i * 37) % 100) / 100),
    [barCount],
  );
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    // 停止旧循环
    for (const loop of loopsRef.current) {
      loop.stop();
    }
    loopsRef.current = [];

    if (!isPlaying) {
      // 暂停时缓缓降到 0.35，做出静息态
      for (const anim of anims) {
        Animated.timing(anim, {
          toValue: 0.35,
          duration: 260,
          useNativeDriver: false,
        }).start();
      }
      return;
    }

    // 播放时每根条独立循环
    for (let i = 0; i < anims.length; i += 1) {
      const anim = anims[i];
      const duration = 520 + ((i * 73) % 480);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
          Animated.timing(anim, {
            toValue: 0.25,
            duration: duration * 0.9,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
        ]),
      );
      loopsRef.current.push(loop);
      loop.start();
    }

    return () => {
      for (const loop of loopsRef.current) {
        loop.stop();
      }
      loopsRef.current = [];
    };
  }, [anims, isPlaying]);

  const clampedProgress = Math.max(0, Math.min(100, progressPercent));
  const activeBars = Math.round((barCount * clampedProgress) / 100);

  return (
    <View style={[styles.root, { height }]} pointerEvents="none">
      {anims.map((anim, index) => {
        const seed = seeds[index];
        const heightInterp = anim.interpolate({
          inputRange: [0, 1],
          outputRange: [Math.max(4, height * 0.12 * seed), height * seed],
        });
        const isActive = index < activeBars;
        return (
          <Animated.View
            key={index}
            style={[
              styles.bar,
              {
                height: heightInterp,
                backgroundColor: isActive ? accentColor : baselineColor,
                opacity: isActive ? 0.95 : 0.55,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 6,
  },
  bar: {
    flex: 1,
    marginHorizontal: 1.5,
    borderRadius: 2,
  },
});
