import React from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, X } from "lucide-react-native";

import { Touchable } from "@/components/Touchable";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";

export interface BatchActionItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  onPress: () => void;
}

export interface BatchActionBarProps {
  /** 顶部计数文案，如 `已选 12 首` 或下载进度 */
  headerText: string;
  /** 全选按钮文案（不传则不显示） */
  selectAllLabel?: string;
  /** 是否处于「全选」状态（用于切换文案为取消全选） */
  allSelected?: boolean;
  onToggleSelectAll?: () => void;
  /** 退出选择模式 */
  onExit: () => void;
  /** 批量任务进行中（禁用 header 与网格操作） */
  busy?: boolean;
  actions: BatchActionItem[];
  /** 外层定位由调用方控制 */
  style?: StyleProp<ViewStyle>;
}

/**
 * 现代移动端批量操作底部工具栏：
 * - 悬浮卡片式微底座（Floating Glass Toolbar）；
 * - 顶部状态行：高亮选中计数 + 全选胶囊 + 退出按钮；
 * - 下方操作单元：扁平圆形微底座图标 + 语义文字，消除厚重视觉水泥块；
 * - 具备流畅按压反馈与触觉震动。
 */
export function BatchActionBar({
  headerText,
  selectAllLabel,
  allSelected = false,
  onToggleSelectAll,
  onExit,
  busy = false,
  actions,
  style,
}: BatchActionBarProps) {
  const insets = useSafeAreaInsets();
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View
      style={[
        styles.toolbar,
        {
          backgroundColor: palette.surface,
          borderColor: withAlpha(palette.border, 0.8),
          paddingBottom: Math.max(insets.bottom, spacing.s) + spacing.xs,
        },
        style,
      ]}
    >
      {/* 顶部计数与全局操作栏 */}
      <View style={styles.header}>
        <View style={styles.counterWrap}>
          <Text style={[styles.countText, { color: palette.text }]} numberOfLines={1}>
            {headerText}
          </Text>
        </View>

        <View style={styles.headerRightActions}>
          {onToggleSelectAll && selectAllLabel ? (
            <Touchable
              style={[
                styles.selectAllChip,
                {
                  backgroundColor: allSelected
                    ? withAlpha(palette.primary, 0.12)
                    : palette.surfaceMuted,
                  borderColor: allSelected ? palette.primary : "transparent",
                },
              ]}
              onPress={() => {
                hapticLight();
                onToggleSelectAll();
              }}
              disabled={busy}
              activeScale={0.96}
              accessibilityRole="button"
              accessibilityLabel={allSelected ? "取消全选" : selectAllLabel}
            >
              {allSelected ? (
                <Check size={13} color={palette.primary} style={{ marginRight: 2 }} />
              ) : null}
              <Text
                style={[
                  styles.selectAllText,
                  { color: allSelected ? palette.primary : palette.text },
                ]}
              >
                {allSelected ? "取消全选" : selectAllLabel}
              </Text>
            </Touchable>
          ) : null}

          <Touchable
            style={[styles.exitChip, { backgroundColor: palette.surfaceMuted }]}
            onPress={() => {
              hapticLight();
              onExit();
            }}
            disabled={busy}
            activeScale={0.96}
            accessibilityRole="button"
            accessibilityLabel="退出多选"
          >
            <X size={14} color={palette.textMuted} />
            <Text style={[styles.exitText, { color: palette.textMuted }]}>退出</Text>
          </Touchable>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: palette.border }]} />

      {/* 底部 4 宫格等宽操作项（现代轻量图标 + 文字） */}
      <View style={styles.grid}>
        {actions.map((action) => {
          const disabled = busy || action.disabled;
          return (
            <Touchable
              key={action.key}
              style={[styles.actionCell, disabled && styles.actionDisabled]}
              onPress={() => {
                hapticLight();
                action.onPress();
              }}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ disabled }}
              activeScale={0.92}
            >
              <View
                style={[
                  styles.iconCircle,
                  {
                    backgroundColor: disabled
                      ? palette.surfaceMuted
                      : withAlpha(palette.primary, 0.1),
                  },
                ]}
              >
                {action.icon ? (
                  React.isValidElement(action.icon)
                    ? React.cloneElement(
                        action.icon as React.ReactElement<{ color?: string; size?: number }>,
                        {
                          color: disabled ? palette.textSubtle : palette.primary,
                          size: 20,
                        },
                      )
                    : action.icon
                ) : null}
              </View>
              <Text
                style={[
                  styles.actionLabel,
                  {
                    color: disabled ? palette.textSubtle : palette.text,
                    fontWeight: disabled ? "500" : "600",
                  },
                ]}
                numberOfLines={1}
              >
                {action.label}
              </Text>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: spacing.m,
    paddingTop: spacing.s,
    paddingBottom: spacing.m,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -3 },
    elevation: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
    minHeight: 38,
  },
  counterWrap: {
    flex: 1,
  },
  countText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  headerRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  selectAllChip: {
    flexDirection: "row",
    alignItems: "center",
    height: 32,
    paddingHorizontal: spacing.m,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  selectAllText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  exitChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 32,
    paddingHorizontal: spacing.m,
    borderRadius: radius.md,
  },
  exitText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xs,
    opacity: 0.6,
  },
  grid: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: spacing.xs,
  },
  actionCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 4,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  actionLabel: {
    fontSize: 12,
  },
});

// 定位辅助：吸附在屏幕底部
export function batchToolbarPositionStyle(): ViewStyle {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  };
}
