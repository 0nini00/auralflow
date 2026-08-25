import React from "react";
import { StyleSheet, View } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { layout, radius, spacing } from "@/theme/tokens";

/**
 * 歌单详情骨架屏：头部 Hero（封面 + 文案条）+ 歌曲行占位。
 * 用统一的三态占位组件 LoadingState 时首屏只有转圈，感知等待长；
 * 骨架屏给出内容结构预告，感知等待时间显著下降。
 */
export function PlaylistDetailSkeleton() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const blockColor = palette.surfaceStrong;
  const rows = Array.from({ length: 10 }, (_, i) => i);

  return (
    <View style={styles.container}>
      {/* Hero 区：封面 + 两行文案 */}
      <View style={styles.hero}>
        <View style={[styles.heroCover, { backgroundColor: blockColor }]} />
        <View style={styles.heroCopy}>
          <View style={[styles.heroLine, { backgroundColor: blockColor, width: "80%" }]} />
          <View style={[styles.heroLine, { backgroundColor: blockColor, width: "55%" }]} />
          <View style={[styles.heroLine, { backgroundColor: blockColor, width: "40%" }]} />
        </View>
      </View>
      {/* 动作条占位 */}
      <View style={[styles.actionBar, { backgroundColor: blockColor }]} />
      {/* 歌曲行占位 */}
      {rows.map((row) => (
        <View key={row} style={styles.row}>
          <View style={[styles.rowCover, { backgroundColor: blockColor }]} />
          <View style={styles.rowInfo}>
            <View style={[styles.rowLine, { backgroundColor: blockColor, width: row % 3 === 0 ? "70%" : "50%" }]} />
            <View style={[styles.rowLine, { backgroundColor: blockColor, width: "35%" }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.m,
    gap: spacing.xs,
  },
  hero: {
    flexDirection: "row",
    gap: spacing.m,
    marginBottom: spacing.m,
  },
  heroCover: {
    width: 112,
    height: 112,
    borderRadius: radius.md,
  },
  heroCopy: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.s,
  },
  heroLine: {
    height: 14,
    borderRadius: radius.sm,
  },
  actionBar: {
    height: 40,
    borderRadius: radius.md,
    marginBottom: spacing.m,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    minHeight: layout.songRowMinHeight,
    paddingVertical: 6,
  },
  rowCover: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
  },
  rowInfo: {
    flex: 1,
    gap: 8,
  },
  rowLine: {
    height: 12,
    borderRadius: 4,
  },
});
