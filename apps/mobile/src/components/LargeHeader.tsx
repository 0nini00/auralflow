import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { layout, spacing, typography } from "@/theme/tokens";

export interface LargeHeaderProps {
  title: string;
  /** 标题上方的小字：日期、问候语或分类说明 */
  eyebrow?: string;
  /** 右侧操作：头像、搜索、设置等 */
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * 主 Tab 的大标题。
 *
 * 与 push 页的 PageHeader 分工：主 Tab 用 28px 大标题建立页面身份，
 * 滚动时（后续阶段）可收成 56px；push 页只保留返回 + 标题 + 操作。
 */
export function LargeHeader({ title, eyebrow, right, style }: LargeHeaderProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View style={[styles.root, { paddingHorizontal: layout.pagePadding }, style]}>
      <View style={styles.copy}>
        {eyebrow ? (
          <Text style={[styles.eyebrow, { color: palette.textMuted }]} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {title}
        </Text>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing.s,
    paddingTop: spacing.xxs,
    paddingBottom: spacing.m,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: typography.caption,
    lineHeight: 16,
    letterSpacing: 0.1,
  },
  title: {
    marginTop: 2,
    fontSize: typography.display,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.6,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingBottom: 2,
  },
});
