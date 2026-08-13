import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

export interface SummaryCardItem {
  key: string;
  label: string;
  count: number;
}

interface SummaryCardGridProps {
  items: SummaryCardItem[];
  onPress: (key: string) => void;
}

/**
 * 搜索结果分区摘要卡片（综合 Tab 顶部的「单曲 N / 歌手 N / 专辑 N / 歌单 N」）。
 * 从 SearchScreen 抽离，作为可复用的分区统计网格。
 */
export function SummaryCardGrid({ items, onPress }: SummaryCardGridProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={`查看${item.label}结果，共 ${item.count} 项`}
          style={[styles.card, { backgroundColor: palette.surface }]}
          onPress={() => onPress(item.key)}
        >
          <Text style={[styles.value, { color: palette.text }]}>{item.count}</Text>
          <Text style={[styles.label, { color: palette.textMuted }]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.m,
  },
  card: {
    width: "48%",
    borderRadius: radius.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.s,
    gap: spacing.xxs,
  },
  value: {
    fontSize: typography.heading,
    fontWeight: "700",
  },
  label: {
    fontSize: typography.caption,
  },
});
