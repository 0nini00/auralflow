import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { spacing, typography } from "@/theme/tokens";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

export interface SettingsPageProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

/**
 * 设置二级页统一脚手架。
 * 导航栏已有页面标题，页内不再重复大标题，只保留一行简短说明（首页风格的小字描述），
 * 内容以 SettingsCard 卡片排列。
 */
export function SettingsPage({ title, description, children }: SettingsPageProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <ScreenScaffold>
      <ScreenScrollView accessibilityLabel={`${title}，${description}`} contentContainerStyle={styles.container}>
        <Text accessibilityRole="summary" style={[styles.description, { color: palette.textMuted }]}>
          {description}
        </Text>
        <View style={styles.content}>{children}</View>
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.m, paddingBottom: spacing.s },
  description: {
    fontSize: typography.body,
    lineHeight: 20,
  },
  content: { gap: spacing.s },
});
