import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";

import { IconButton } from "@/components/IconButton";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { layout, spacing, typography } from "@/theme/tokens";

export interface PageHeaderProps {
  title: string;
  canGoBack: boolean;
  onGoBack: () => void;
  /** 右侧操作（可选）：详情页的分享、更多等 */
  right?: React.ReactNode;
}

/**
 * push 页顶栏：返回 + 标题 + 操作。
 *
 * 与旧 AppHeader 的区别：不再承载全局搜索框与主题切换。
 * 搜索收敛到搜索 Tab，主题收敛到「我的 → 外观」。
 */
export function PageHeader({ title, canGoBack, onGoBack, right }: PageHeaderProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: palette.background,
          borderBottomColor: palette.border,
          paddingHorizontal: layout.pagePadding - 8,
        },
      ]}
    >
      <View style={styles.side}>
        {canGoBack ? (
          <IconButton
            onPress={onGoBack}
            tone="strong"
            accessibilityLabel="返回"
            render={({ size, color }) => <ChevronLeft size={size} strokeWidth={2} color={color} />}
          />
        ) : null}
      </View>
      <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minHeight: layout.headerHeight,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  side: {
    width: 88,
    flexDirection: "row",
    alignItems: "center",
  },
  right: {
    justifyContent: "flex-end",
  },
  title: {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    fontSize: typography.title,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});
