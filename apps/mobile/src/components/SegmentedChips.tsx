import React from "react";
import { ScrollView, StyleSheet } from "react-native";

import { Chip } from "@/components/ui/Chip";
import { layout, spacing } from "@/theme/tokens";

export interface SegmentedChipItem<T extends string> {
  key: T;
  label: string;
}

interface SegmentedChipsProps<T extends string> {
  items: readonly SegmentedChipItem<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * 横向分段芯片：音乐库的五个分段。
 * 选中态由 ui/Chip 统一提供（浅色墨色实心 / 深色品牌绿实心）。
 */
export function SegmentedChips<T extends string>({
  items,
  value,
  onChange,
}: SegmentedChipsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      {items.map((item) => (
        <Chip
          key={item.key}
          label={item.label}
          size="compact"
          selected={value === item.key}
          onPress={() => onChange(item.key)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  row: {
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xxs,
    paddingBottom: spacing.s,
    gap: spacing.xs,
    alignItems: "center",
  },
});
