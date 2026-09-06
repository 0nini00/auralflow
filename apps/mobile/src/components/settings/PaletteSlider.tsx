import React, { useRef, useState } from "react";
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import type { ThemePalette } from "@/stores/themeStore";

/** 默认滑块刻度数：未显式传 step 时按 (max-min)/刻度数 吸附 */
const SLIDER_STEPS = 40;
const THUMB_SIZE = 22;

interface PaletteSliderProps {
  value: number;
  min: number;
  max: number;
  /** 吸附步长；缺省按 (max-min)/40 吸附 */
  step?: number;
  palette: ThemePalette;
  onChange: (value: number) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * 调色板驱动的滑块核心（轨道 + 填充 + 圆点），由播放设置 Sheet（紧凑行）
 * 与设置页（整行）共用，避免各自维护一份拖拽实现。
 *
 * 轨道宽度动态实测（onLayout），thumb/fill 不按硬编码宽度计算；
 * 按住/拖动经 responder 的 pageX + measure 换算，值按 step 吸附后回调。
 */
export function PaletteSlider({ value, min, max, step, palette, onChange, style }: PaletteSliderProps) {
  const trackRef = useRef<View>(null);
  const [trackW, setTrackW] = useState(0);
  const stepSize = step ?? (max - min) / SLIDER_STEPS;
  const usableWidth = Math.max(0, trackW - THUMB_SIZE);
  const ratio = trackW > 0 ? (value - min) / (max - min) : 0;

  const updateFromPageX = (pageX: number) => {
    if (usableWidth <= 0) return;
    trackRef.current?.measure((_x, _y, _w, _h, pageX0) => {
      const localX = pageX - pageX0 - THUMB_SIZE / 2;
      const r = Math.max(0, Math.min(1, localX / usableWidth));
      const snapped = Math.round((min + r * (max - min)) / stepSize) * stepSize;
      onChange(Math.max(min, Math.min(max, snapped)));
    });
  };

  return (
    <View
      ref={trackRef}
      style={[styles.trackWrap, style]}
      onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => updateFromPageX(e.nativeEvent.pageX)}
      onResponderMove={(e) => updateFromPageX(e.nativeEvent.pageX)}
    >
      <View style={[styles.track, { backgroundColor: palette.surfaceMuted }]} />
      <View
        style={[
          styles.fill,
          {
            backgroundColor: palette.primary,
            width: Math.max(THUMB_SIZE / 2, usableWidth * ratio + THUMB_SIZE / 2),
          },
        ]}
      />
      <View
        style={[
          styles.thumb,
          {
            left: usableWidth * ratio,
            backgroundColor: palette.primaryText,
            borderColor: palette.primary,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  trackWrap: {
    position: "relative",
    height: 22,
    justifyContent: "center",
  },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
  },
  fill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
  },
});
