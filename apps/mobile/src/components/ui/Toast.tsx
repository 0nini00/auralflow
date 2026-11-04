import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Check, Info, TriangleAlert } from "lucide-react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { interaction, radius, spacing, typography } from "@/theme/tokens";

/**
 * 轻提示（toast）—— 非阻塞的操作反馈。
 *
 * 此前移动端把「导入成功」「登录成功」「添加成功」这类不需要决策的结果全部
 * 交给 Alert.alert（全仓 83 处），每一次都要用户点一下「好」才能继续，
 * 播放器这种连续操作的场景被反复打断。
 *
 * 分工：需要用户做决定 / 必须中断 → 继续用 Alert；只是「我做完了」→ 走这里。
 *
 * 位置放在顶部而不是底部：底部已经被「迷你播放器 + 标签栏」占满，
 * 无论放哪一侧都会遮住正在播放的信息。
 */

export type ToastKind = "success" | "info" | "error";

export interface ToastOptions {
  kind?: ToastKind;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  actionLabel?: string;
  onAction?: () => void;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(items);
}

function dismiss(id: number) {
  items = items.filter((item) => item.id !== id);
  emit();
}

export function showToast(message: string, options: ToastOptions = {}): number {
  const id = nextId++;
  const item: ToastItem = {
    id,
    message,
    kind: options.kind ?? "success",
    actionLabel: options.actionLabel,
    onAction: options.onAction,
  };
  items = [...items.slice(-1), item];
  emit();
  const duration = options.duration ?? (item.kind === "error" ? 3800 : 2400);
  setTimeout(() => dismiss(id), duration);
  return id;
}

const KIND_ICON = { success: Check, info: Info, error: TriangleAlert } as const;

function ToastRow({ item }: { item: ToastItem }) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const Icon = KIND_ICON[item.kind];
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  // 顶部反色卡片：任何页面背景上都能看清，不依赖当前主题的层级关系
  const isDark = palette.isDark;
  const background = isDark ? "#e8eee8" : "#1b2018";
  const foreground = isDark ? "#111a15" : "#f4f7f3";

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.row,
        {
          backgroundColor: background,
          transform: [
            {
              translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }),
            },
          ],
          opacity: enter,
        },
      ]}
    >
      <Icon size={16} color={foreground} strokeWidth={2} />
      <Text style={[styles.text, { color: foreground }]} numberOfLines={2}>
        {item.message}
      </Text>
      {item.actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.actionLabel}
          onPress={() => {
            item.onAction?.();
            dismiss(item.id);
          }}
          style={({ pressed }) => [styles.action, pressed && { opacity: interaction.pressedOpacity }]}
        >
          <Text style={[styles.actionLabel, { color: foreground }]}>{item.actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function ToastHost() {
  const [visible, setVisible] = useState<ToastItem[]>(items);

  useEffect(() => {
    const listener: Listener = (next) => setVisible(next);
    listeners.add(listener);
    listener(items);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={styles.host}>
      {visible.map((item) => (
        <ToastRow key={item.id} item={item} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    // SafeAreaView 已经吃掉了状态栏高度，这里的 0 就是「顶栏之下、页面之上」
    top: spacing.xs,
    left: spacing.m,
    right: spacing.m,
    gap: spacing.xs,
    zIndex: 100,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.snug,
    minHeight: 44,
    paddingVertical: spacing.snug,
    paddingHorizontal: spacing.cozy,
    borderRadius: radius.lg,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  text: {
    flex: 1,
    minWidth: 0,
    fontSize: typography.meta,
    lineHeight: 19,
    fontWeight: "500",
  },
  action: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  actionLabel: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
});
