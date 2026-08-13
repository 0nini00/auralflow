import React, { useState } from "react";
import { View, StyleSheet, Pressable, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";

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

  const progress = duration > 0 ? (seeking ? seekPosition : position) / duration : 0;
  const bufferedProgress =
    duration > 0 && typeof buffered === "number" && Number.isFinite(buffered)
      ? Math.min(1, buffered / duration)
      : undefined;

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
        <View
          style={[
            styles.fill,
            {
              width: `${progress * 100}%`,
              backgroundColor: palette.primary,
            },
          ]}
        />
        <View
          style={[
            styles.thumb,
            {
              left: `${progress * 100}%`,
              backgroundColor: palette.primary,
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
  thumb: {
    position: "absolute",
    top: -4,
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
  },
});
