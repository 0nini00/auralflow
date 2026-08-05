import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { LyricLine } from "@lx/core";
import type { ThemePalette } from "@/stores/themeStore";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";

interface MiniLyricProps {
  lyrics: LyricLine[];
  currentLineIndex: number;
  palette: ThemePalette;
}

/** 封面页底部的单行迷你歌词（参考 lx 播放详情的迷你歌词）。 */
export function MiniLyric({ lyrics, currentLineIndex, palette }: MiniLyricProps) {
  const showTranslation = useLyricSettingsStore((s) => s.showTranslation);
  const fontSize = useLyricSettingsStore((s) => s.fontSize);
  const current = lyrics && currentLineIndex >= 0 ? lyrics[currentLineIndex] : undefined;

  if (!current || !current.text) {
    return (
      <View style={styles.container} pointerEvents="none">
        <Text style={[styles.line, { color: palette.textMuted }]}>正在播放 · 暂无歌词</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} pointerEvents="none">
      <Text
        numberOfLines={1}
        style={[
          styles.line,
          { color: palette.text, fontSize: Math.max(12, Math.round(fontSize * 0.7)) },
        ]}
      >
        {current.text}
      </Text>
      {showTranslation && current.tr ? (
        <Text numberOfLines={1} style={[styles.translation, { color: palette.textMuted }]}>
          {current.tr}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 92,
    alignItems: "center",
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
