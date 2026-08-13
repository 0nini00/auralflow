import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { X } from "lucide-react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { layout, radius, spacing, typography } from "@/theme/tokens";

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
  /** 外层定位（absolute/left/right/bottom 等）由调用方控制 */
  style?: StyleProp<ViewStyle>;
}

/**
 * 歌单等场景的「批量选择」底部操作栏：顶部计数 + 全选/退出，
 * 下方图标+文字的等宽操作格（队列/下一首/收藏/下载等）。
 * 统一了此前 PlaylistDetailScreen 内自建的 BatchActionButton 与工具栏样式，
 * 供所有多选场景复用。
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
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View style={[styles.toolbar, { backgroundColor: palette.surface, borderColor: palette.border }, style]}>
      <View style={styles.header}>
        <Text style={[styles.count, { color: palette.text }]} numberOfLines={1}>
          {headerText}
        </Text>
        {onToggleSelectAll && selectAllLabel ? (
          <Pressable style={styles.headerButton} onPress={onToggleSelectAll} disabled={busy}>
            <Text
              style={[styles.headerButtonText, { color: busy ? palette.textMuted : palette.primary }]}
            >
              {allSelected ? "取消全选" : selectAllLabel}
            </Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.exitButton} onPress={onExit} disabled={busy}>
          <X size={18} color={busy ? palette.textMuted : palette.text} />
          <Text style={[styles.headerButtonText, { color: busy ? palette.textMuted : palette.text }]}>退出</Text>
        </Pressable>
      </View>
      <View style={styles.grid}>
        {actions.map((action) => {
          const disabled = busy || action.disabled;
          return (
            <Pressable
              key={action.key}
              style={[styles.action, { backgroundColor: palette.surfaceStrong }, disabled && styles.actionDisabled]}
              onPress={action.onPress}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ disabled }}
            >
              {action.icon ? (
                <View style={styles.actionIcon}>
                  {React.isValidElement(action.icon)
                    ? React.cloneElement(action.icon as React.ReactElement<{ color?: string }>, {
                        color: disabled ? palette.textMuted : palette.primary,
                      })
                    : action.icon}
                </View>
              ) : null}
              <Text
                style={[styles.actionText, { color: disabled ? palette.textMuted : palette.text }]}
                numberOfLines={1}
              >
                {action.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    minHeight: 140,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    padding: spacing.s,
    gap: spacing.s,
  },
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  count: {
    flex: 1,
    minWidth: 0,
    fontSize: typography.body,
    fontWeight: "700",
  },
  headerButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  exitButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
  },
  headerButtonText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
  grid: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  action: {
    flex: 1,
    minWidth: 0,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xxs,
  },
  actionDisabled: {
    opacity: 0.55,
  },
  actionIcon: {
    minHeight: 20,
    justifyContent: "center",
  },
  actionText: {
    maxWidth: "100%",
    fontSize: typography.caption,
    fontWeight: "600",
  },
});

// 定位辅助：调用方把 toolbar 固定在底部（默认与页面同宽）
export function batchToolbarPositionStyle(): ViewStyle {
  return {
    position: "absolute",
    left: layout.pagePadding,
    right: layout.pagePadding,
    bottom: 0,
  };
}
