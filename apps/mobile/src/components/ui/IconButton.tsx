import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { withAlpha } from "@/services/themePaletteModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { control, controlHitSlop, type IconButtonControlSize, type IconButtonTone } from "@/theme/tokens";

export interface IconButtonProps extends Omit<PressableProps, "style" | "children"> {
  render: (props: { size: number; color: string }) => React.ReactNode;
  size?: IconButtonControlSize;
  tone?: IconButtonTone;
  selected?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  render,
  size = "standard",
  tone = "default",
  selected = false,
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityState,
  style,
  ...rest
}: IconButtonProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const spec = control.iconButton[size];
  const isDisabled = disabled || loading;
  const effectiveTone: IconButtonTone = selected && tone === "default" ? "inverse" : tone;
  const color = getIconColor(effectiveTone, palette);
  const backgroundColor = getIconBackground(effectiveTone, palette);

  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, disabled: isDisabled, selected, busy: loading }}
      disabled={isDisabled}
      hitSlop={controlHitSlop(size)}
      style={({ pressed }) => [
        styles.base,
        { width: spec.size, height: spec.size, backgroundColor },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={color} size="small" /> : render({ size: spec.icon, color })}
    </Pressable>
  );
}

function getIconColor(tone: IconButtonTone, palette: ReturnType<typeof getThemePalette>) {
  switch (tone) {
    case "inverse":
      return palette.primaryText;
    case "danger":
      return palette.danger;
    case "muted":
      return palette.textSubtle;
    case "translucent":
      return "#FFFFFF";
    case "default":
    default:
      return palette.text;
  }
}

function getIconBackground(tone: IconButtonTone, palette: ReturnType<typeof getThemePalette>) {
  switch (tone) {
    case "danger":
      return palette.dangerSurface;
    case "translucent":
      return withAlpha("000000", 0.32);
    default:
      return "transparent";
  }
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.68 },
});
