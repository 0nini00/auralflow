import React from "react";
import { ImageBackground, StyleSheet, View, type ViewStyle } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface AppBackgroundProps {
  style?: ViewStyle;
  children: React.ReactNode;
}

/**
 * 应用最外层背景层。当用户设置了自定义背景图时，用 ImageBackground 铺满，
 * 并叠加一层主题色遮罩控制可读性；未设置时降级为纯背景色。
 * 与桌面端 `<div class="af-app-background">` 语义一致。
 */
export function AppBackground({ style, children }: AppBackgroundProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const backgroundImageUri = useThemeStore((state) => state.backgroundImageUri);
  const backgroundOpacity = useThemeStore((state) => state.backgroundOpacity);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  if (!backgroundImageUri) {
    return (
      <View style={[styles.root, { backgroundColor: palette.background }, style]}>
        {children}
      </View>
    );
  }

  return (
    <ImageBackground
      source={{ uri: backgroundImageUri }}
      style={[styles.root, style]}
      resizeMode="cover"
      onError={() => {
        // 图片加载失败时清空 URI，避免长期显示黑屏
        void useThemeStore.getState().setBackgroundImageUri(null);
      }}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: palette.background, opacity: backgroundOpacity },
        ]}
      />
      <View style={styles.content}>{children}</View>
    </ImageBackground>
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
