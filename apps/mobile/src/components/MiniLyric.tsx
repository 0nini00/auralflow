import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { LyricLine } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import { Touchable } from "@/components/Touchable";
import { convertChineseText } from "@/services/chineseConversionService";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";

interface MiniLyricProps {
  lyrics: LyricLine[];
  currentLineIndex: number;
  palette: ThemePalette;
  /** 点击迷你歌词 → 切换到歌词页（对齐 lx MiniLyric onPress） */
  onPress?: () => void;
}

/** 封面页底部的单行迷你歌词（参考 lx 播放详情的迷你歌词）。 */
export function MiniLyric({ lyrics, currentLineIndex, palette, onPress }: MiniLyricProps) {
  const showTranslation = useLyricSettingsStore((s) => s.showTranslation);
  const fontSize = useLyricSettingsStore((s) => s.fontSize);
  // 与沉浸歌词 LyricView 保持一致，应用简繁转换
  const chineseConversion = useLyricSettingsStore((s) => s.chineseConversion);
  const current = lyrics && currentLineIndex >= 0 ? lyrics[currentLineIndex] : undefined;

  if (!current || !current.text) {
    // 空状态同样可点击切到歌词页（对齐 lx 迷你歌词占位符可点）
    const empty = (
      <Text style={[styles.line, { color: palette.textMuted }]}>正在播放 · 暂无歌词</Text>
    );
    if (onPress) {
      return (
        <Touchable
          style={styles.container}
          onPress={onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="查看歌词"
        >
          {empty}
        </Touchable>
      );
    }
    return <View style={styles.container} pointerEvents="none">{empty}</View>;
  }

  const content = (
    <>
      <Text
        numberOfLines={1}
        style={[
          styles.line,
          { color: palette.text, fontSize: Math.max(12, Math.round(fontSize * 0.7)) },
        ]}
      >
        {convertChineseText(current.text, chineseConversion)}
      </Text>
      {showTranslation && current.tr ? (
        <Text numberOfLines={1} style={[styles.translation, { color: palette.textMuted }]}>
          {convertChineseText(current.tr, chineseConversion)}
        </Text>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Touchable
        style={styles.container}
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="查看歌词"
      >
        {content}
      </Touchable>
    );
  }

  return <View style={styles.container} pointerEvents="none">{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    // 相对封面页垂直居中偏下，底部播放区是文档流（不再是 absolute 覆盖），
    // 不再用固定 bottom 值，避免与底部播放区重叠。
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 8,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 16,
  },
  line: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  translation: {
    fontSize: 12,
    marginTop: 2,
    textAlign: "center",
  },
});
