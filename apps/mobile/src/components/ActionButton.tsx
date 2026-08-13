import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

export interface ActionButtonProps {
  label: string;
  /** 主按钮行尾的次要计数文案，如 `(30)` */
  count?: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** 让按钮在 flex 行里伸展占满剩余空间（播放全部等主行动） */
  grow?: boolean;
  /** 允许按钮在 flex 行里收缩以适应单行（对齐 lx 等宽三键） */
  shrink?: boolean;
  /** 紧凑字号/内边距（对齐 lx 13px 等宽操作键） */
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * 统一的动作按钮（pill 形态）：
 * - primary：主色填充（播放全部等核心行动）
 * - secondary：surface 底 + 描边（随机播放、刷新、收藏等次级行动）
 * - danger：dangerSurface 底（删除等破坏性行动）
 * 替代各详情页自建的自说自话按钮样式（原存在 3 套尺寸变体），统一最小触控高度与字号。
 */
export function ActionButton({
  label,
  count,
  variant = "secondary",
  disabled = false,
  loading = false,
  onPress,
  accessibilityLabel,
  grow = false,
  shrink = false,
  small = false,
  style,
}: ActionButtonProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const backgroundColor = isPrimary ? palette.primary : isDanger ? palette.dangerSurface : palette.surface;
  const borderColor = isPrimary ? palette.primary : isDanger ? palette.dangerSurface : palette.border;
  const textColor = isPrimary
    ? palette.primaryText
    : isDanger
      ? palette.danger
      : disabled
        ? palette.textMuted
        : palette.primary;
  const spinnerColor = isPrimary ? palette.primaryText : isDanger ? palette.danger : palette.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, borderColor },
        grow && styles.grow,
        shrink && styles.shrink,
        small && styles.small,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} size="small" />
      ) : (
        <Text
          numberOfLines={1}
          style={[styles.label, small && styles.labelSmall, { color: textColor }, isPrimary && styles.labelPrimary, isDanger && styles.labelDanger]}
        >
          {label}
          {count ? <Text style={[styles.count, small && styles.countSmall, { color: isPrimary ? palette.primaryText : textColor }]}>{count}</Text> : null}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touch.minTarget,
    minWidth: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  grow: {
    flexGrow: 1,
  },
  shrink: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
  small: {
    minHeight: 34,
    minWidth: 60,
    paddingHorizontal: spacing.s,
  },
  labelSmall: {
    fontSize: 13,
  },
  countSmall: {
    fontSize: 13,
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  labelPrimary: {
    fontWeight: "700",
  },
  labelDanger: {
    fontWeight: "700",
  },
  count: {
    fontSize: typography.body,
    opacity: 0.7,
    marginLeft: spacing.xxs,
  },
});
