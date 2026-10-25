import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ChevronRight, type LucideIcon } from "lucide-react-native";

import { Touchable } from "@/components/Touchable";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

export interface SettingsRowProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  onPress: () => void;
  /** 组内最后一行传 false：避免行底分隔线与卡片底边叠成一条粗线 */
  divider?: boolean;
}

/** 设置行：32px 图标底 + 15px 标题 + 11px 说明 + 右箭头，整行 56px 可点。 */
export function SettingsRow({ icon: Icon, title, description, onPress, divider = true }: SettingsRowProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <Touchable
      onPress={onPress}
      activeScale={0.99}
      accessibilityRole="button"
      accessibilityLabel={description ? `${title}，${description}` : title}
      style={[styles.row, { borderBottomColor: palette.border }, !divider && styles.rowWithoutDivider]}
    >
      <View style={[styles.iconTile, { backgroundColor: palette.surfaceMuted }]}>
        <Icon size={18} color={palette.text} strokeWidth={1.8} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
          {title}
        </Text>
        {description ? (
          <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={1}>
            {description}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={18} color={palette.textSubtle} strokeWidth={1.8} />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingHorizontal: spacing.s,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowWithoutDivider: {
    borderBottomWidth: 0,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: typography.body,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  description: {
    marginTop: 2,
    fontSize: typography.micro,
    lineHeight: 14,
  },
});
