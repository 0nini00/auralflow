import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { withAlpha } from "@/services/themePaletteModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { control, type ButtonSize, type ButtonVariant } from "@/theme/tokens";

export interface ButtonProps extends Omit<PressableProps, "style" | "children"> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}

export function Button({
  label,
  variant = "primary",
  size = "medium",
  loading = false,
  disabled = false,
  leading,
  trailing,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  onPress,
  style,
  labelStyle,
  ...rest
}: ButtonProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const spec = control.button[size];
  const isDisabled = disabled || loading;

  const colors = getButtonColors(variant, palette);
  const content = loading ? (
    <ActivityIndicator color={colors.textColor} size="small" />
  ) : (
    <>
      {leading ? <View style={styles.icon}>{leading}</View> : null}
      <Text numberOfLines={1} style={[styles.label, { color: colors.textColor, fontSize: spec.labelSize }, labelStyle]}>
        {label}
      </Text>
      {trailing ? <View style={styles.icon}>{trailing}</View> : null}
    </>
  );

  return (
    <Pressable
      {...rest}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ ...accessibilityState, disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: spec.height,
          minWidth: spec.minWidth,
          paddingHorizontal: spec.horizontalPadding,
          borderRadius: spec.radius,
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
        },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

export function getButtonColors(variant: ButtonVariant, palette: ReturnType<typeof getThemePalette>) {
  switch (variant) {
    case "secondary":
      return { backgroundColor: palette.surface, borderColor: palette.border, textColor: palette.primary };
    case "outline":
      return { backgroundColor: "transparent", borderColor: palette.primary, textColor: palette.primary };
    case "danger":
      return { backgroundColor: palette.dangerSurface, borderColor: palette.danger, textColor: palette.danger };
    case "ghost":
      return { backgroundColor: "transparent", borderColor: "transparent", textColor: palette.primary };
    case "primary":
    default:
      // 强调按钮不再实心填充：表面色底 + 强调色文字 + 细边框（用户 2026-08 要求，
      // 全局仅删除类 danger 保留红色调；实心强调色按钮全部退场）
      return { backgroundColor: palette.surface, borderColor: palette.border, textColor: palette.primary };
  }
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    gap: 8,
  },
  icon: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    flexShrink: 1,
    fontWeight: "600",
    textAlign: "center",
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.76,
  },
});

export type ButtonPressEvent = GestureResponderEvent;
export { withAlpha };
