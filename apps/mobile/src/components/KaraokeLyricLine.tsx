import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * karaoke 风格逐字歌词进度：底层用普通色文字，
 * 上层用 accent 色文字被 overflow:hidden + 宽度百分比裁剪，
 * 随播放进度从左到右点亮。
 */
export interface KaraokeLyricLineProps {
  text: string;
  progress: number; // 0..1
  baseColor: string;
  activeColor: string;
  fontSize: number;
  lineHeight?: number;
  fontWeight?: "400" | "500" | "600" | "700";
  textAlign?: "left" | "center" | "right";
}

export function KaraokeLyricLine({
  text,
  progress,
  baseColor,
  activeColor,
  fontSize,
  lineHeight,
  fontWeight = "700",
  textAlign = "center",
}: KaraokeLyricLineProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  const displayText = text || " ";
  const percent = `${(clamped * 100).toFixed(2)}%` as `${number}%`;

  return (
    <View style={[styles.wrap, { alignSelf: alignSelfFor(textAlign) }]}>
      <Text
        style={{
          color: baseColor,
          fontSize,
          lineHeight,
          fontWeight,
          textAlign,
        }}
      >
        {displayText}
      </Text>
      <View
        style={[
          styles.overlay,
          {
            width: percent,
          },
        ]}
        pointerEvents="none"
      >
        <Text
          style={{
            color: activeColor,
            fontSize,
            lineHeight,
            fontWeight,
            textAlign,
          }}
          numberOfLines={1}
        >
          {displayText}
        </Text>
      </View>
    </View>
  );
}

function alignSelfFor(textAlign: "left" | "center" | "right"): "flex-start" | "center" | "flex-end" {
  if (textAlign === "left") return "flex-start";
  if (textAlign === "right") return "flex-end";
  return "center";
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    overflow: "hidden",
  },
});
