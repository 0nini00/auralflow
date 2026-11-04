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

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { control, interaction, type ChipSize } from "@/theme/tokens";

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
    : selected
      ? {
          /*
           * 选中态两套主题用同一种语言：实心行动色 + 其上的对比文字。
           * 曾经浅色主题用墨色实心、深色主题用绿色实心——同一个筛选器在切主题后
           * 看起来是两种不同的设计，品牌色也只在深色下出现。
           */
          border: palette.actionFill,
          background: palette.actionFill,
          text: palette.onActionFill,
        }
      : {
          border: palette.border,
          background: palette.surface,
          text: palette.text,
        };
  return (
    <Pressable
      {...rest}
      accessibilityRole="radio"
      accessibilityLabel={rest.accessibilityLabel ?? label}
      accessibilityState={{ ...accessibilityState, disabled: disabled === true, selected }}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6 }}
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
  disabled: { opacity: interaction.disabledOpacity },
  pressed: { opacity: interaction.pressedOpacity },
});
