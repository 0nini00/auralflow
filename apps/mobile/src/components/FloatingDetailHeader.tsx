import React from "react";
import { Animated, StyleSheet, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";

import { IconButton } from "@/components/IconButton";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { layout, spacing, typography } from "@/theme/tokens";

interface FloatingDetailHeaderProps {
  title: string;
  onBack: () => void;
  /**
   * 列表滚动位置。传入后：顶部只有悬浮返回键；滚过封面后浮出实底标题栏。
   * 不传（如骨架屏）：直接显示实底标题栏。
   */
  scrollY?: Animated.Value;
  right?: React.ReactNode;
}

/**
 * 详情页悬浮顶栏。
 *
 * 与 PageHeader 的分工：详情页没有独立顶栏，返回键浮在封面上；
 * 列表滚过封面后，background 与标题一起淡入，形成「吸顶」效果。
 * 返回键始终是深色半透明圆 + 白图标，浅色/深色主题都能压在封面上。
 */
export function FloatingDetailHeader({
  title,
  onBack,
  scrollY,
  right,
}: FloatingDetailHeaderProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const reveal = scrollY
    ? scrollY.interpolate({
        inputRange: [72, 132],
        outputRange: [0, 1],
        extrapolate: "clamp",
      })
    : 1;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: palette.background, opacity: reveal }]}
      />
      <View style={styles.content} pointerEvents="box-none">
        <IconButton
          tone="onImage"
          accessibilityLabel="返回"
          onPress={onBack}
          render={({ size, color }) => <ChevronLeft size={size} color={color} />}
          style={styles.back}
        />
        <Animated.Text
          numberOfLines={1}
          pointerEvents="none"
          style={[styles.title, { color: palette.text, opacity: reveal }]}
        >
          {title}
        </Animated.Text>
        <View style={styles.right} pointerEvents={right ? "auto" : "none"}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: layout.headerHeight,
    zIndex: 20,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  title: {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    fontSize: typography.title,
    fontWeight: "700",
    letterSpacing: -0.2,
    paddingHorizontal: spacing.xxs,
  },
  right: {
    width: 44,
    alignItems: "flex-end",
  },
});
