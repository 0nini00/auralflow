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
import { control, type ChipSize } from "@/theme/tokens";

export interface ChipProps extends Omit<PressableProps, "style" | "children"> {
  label: string;
  selected?: boolean;
  size?: ChipSize;
  leading?: React.ReactNode;
  onImage?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Chip({
  label,
  selected = false,
  size = "standard",
  leading,
  onImage = false,
  disabled = false,
  accessibilityState,
  style,
  ...rest
}: ChipProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const spec = control.chip[size];
  const colors = onImage
    ? {
        border: selected ? "#FFFFFF" : "rgba(255, 255, 255, 0.35)",
        background: selected ? "rgba(255, 255, 255, 0.92)" : "rgba(0, 0, 0, 0.35)",
        text: selected ? "#111111" : "#FFFFFF",
      }
    : {
        border: selected ? palette.primary : palette.border,
        background: selected ? withAlpha(palette.primary, 0.14) : palette.surface,
        text: selected ? palette.primary : palette.text,
      };
  return (
    <Pressable
      {...rest}
      accessibilityRole="radio"
      accessibilityLabel={rest.accessibilityLabel ?? label}
      accessibilityState={{ ...accessibilityState, disabled: disabled === true, selected }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: spec.height,
          paddingHorizontal: spec.horizontalPadding,
          borderColor: colors.border,
          backgroundColor: colors.background,
        },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <Text style={[styles.label, { color: colors.text, fontSize: spec.labelSize }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 999,
    gap: 6,
  },
  leading: { alignItems: "center", justifyContent: "center" },
  label: { fontWeight: "600", flexShrink: 1 },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.72 },
});
