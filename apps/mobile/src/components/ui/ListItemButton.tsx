import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { withAlpha } from "@/services/themePaletteModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { control } from "@/theme/tokens";

export interface ListItemButtonProps extends Omit<PressableProps, "style" | "children"> {
  title: string;
  subtitle?: string;
  subtitleColor?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  destructive?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ListItemButton({
  title,
  subtitle,
  subtitleColor,
  leading,
  trailing,
  destructive = false,
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityState,
  style,
  ...rest
}: ListItemButtonProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const isDisabled = disabled || loading;
  const titleColor = destructive ? palette.danger : palette.text;

  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ ...accessibilityState, disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { borderBottomColor: palette.border },
        pressed && !isDisabled && { backgroundColor: withAlpha(palette.primary, 0.08) },
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.content}>
        <Text style={[styles.title, { color: titleColor }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: subtitleColor ?? palette.textMuted }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: control.listItem.minHeight,
    paddingHorizontal: control.listItem.horizontalPadding,
    paddingVertical: control.listItem.verticalPadding,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leading: { marginRight: 12, alignItems: "center", justifyContent: "center" },
  content: { flex: 1, minWidth: 0 },
  title: { fontSize: control.listItem.titleSize, fontWeight: "600" },
  subtitle: { marginTop: 3, fontSize: control.listItem.subtitleSize, lineHeight: 18 },
  trailing: { marginLeft: 12, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.42 },
});
