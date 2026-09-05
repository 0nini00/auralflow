import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface AppBackgroundProps {
  style?: ViewStyle;
  children: React.ReactNode;
}

/**
 * 应用最外层背景层:主题色纯色背景。
 *
 * 结构说明:底色是**不透明纯色 View**,任何子层失效时都保证主题色兜底,
 * 不会把夜间主题洗成灰白、白字对比度归零。
 */
export function AppBackground({ style, children }: AppBackgroundProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View style={[styles.root, { backgroundColor: palette.background }, style]}>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
