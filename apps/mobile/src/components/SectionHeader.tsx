import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing, typography } from "@/theme/tokens";

export interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ title, description, action, style }: SectionHeaderProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View style={[styles.root, style]}>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          {title}
        </Text>
        {description ? (
          <Text style={[styles.description, { color: palette.textMuted }]}>{description}</Text>
        ) : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.s,
  },
  copy: {
    flex: 1,
    minWidth: 180,
    gap: spacing.xxs,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  description: {
    fontSize: typography.meta,
    lineHeight: 18,
  },
  action: {
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
  },
});
