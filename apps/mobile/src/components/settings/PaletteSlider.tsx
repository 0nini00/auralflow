import React, { useState } from "react";
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
  accessibilityLabel: string;
  accessibilityValueText: string;
  palette: ThemePalette;
  onChange: (value: number) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * 调色板驱动的滑块（轨道 + 填充 + 圆点），拖动与读屏共用数值提交规则。
 *
 * 轨道宽度动态实测（onLayout），thumb/fill 不按硬编码宽度计算；
 * 按住/拖动经 responder 的 locationX 换算，值按 step 吸附后回调。
 */
export function PaletteSlider({ value, min, max, step, accessibilityLabel, accessibilityValueText,
  palette, onChange, style }: PaletteSliderProps) {
  const [trackW, setTrackW] = useState(0);
  const stepSize = step ?? (max - min) / SLIDER_STEPS;
  // Android 将无障碍范围转为整数，使用刻度索引保留小数步长的调节语义。
  const stepCount = Math.ceil((max - min) / stepSize);
  const currentStep = Math.round((value - min) / stepSize);
  const usableWidth = Math.max(0, trackW - THUMB_SIZE);
  const ratio = trackW > 0 ? (value - min) / (max - min) : 0;

  const updateValue = (next: number) => {
    const snapped = Math.round(next / stepSize) * stepSize;
    const bounded = Math.max(min, Math.min(max, snapped));
    if (bounded !== value) onChange(bounded);
  };

  // 直接用 locationX（相对本视图原点），不再每次 move 都排一次异步 measure：
  // measure 回调的顺序没有保证，拖快时会让圆点回跳。
  const updateFromLocationX = (locationX: number) => {
    if (usableWidth <= 0) return;
    const localX = locationX - THUMB_SIZE / 2;
    const r = Math.max(0, Math.min(1, localX / usableWidth));
    updateValue(min + r * (max - min));
  };

  return (
    <View
      style={[styles.trackWrap, style]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: stepCount, now: currentStep, text: accessibilityValueText }}
      accessibilityActions={[{ name: "increment", label: "增加" }, { name: "decrement", label: "减少" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") updateValue(value + stepSize);
        if (event.nativeEvent.actionName === "decrement") updateValue(value - stepSize);
      }}
      onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => updateFromLocationX(e.nativeEvent.locationX)}
      onResponderMove={(e) => updateFromLocationX(e.nativeEvent.locationX)}
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
    // 触控区至少 44px（仓库 touch.minTarget），视觉轨道仍居中、高度不变
    height: 44,
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
    top: "50%",
    marginTop: -2,
    height: 4,
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    top: "50%",
    marginTop: -THUMB_SIZE / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
  },
});
