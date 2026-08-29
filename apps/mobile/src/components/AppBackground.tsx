import React from "react";
import { Image, StyleSheet, View, type ViewStyle } from "react-native";

import { getResolvedTheme, getEffectiveBackgroundOpacity, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface AppBackgroundProps {
  style?: ViewStyle;
  children: React.ReactNode;
}

/**
 * 应用最外层背景层。当用户设置了自定义背景图时，在纯色底上以 (1 - 遮罩不透明度)
 * 的不透明度绘制背景图；未设置时降级为纯背景色。与桌面端 `<div class="af-app-background">` 语义一致。
 *
 * 结构说明：底色必须是**不透明纯色 View**，透明度只作用在背景图上。
 * 此前实现是"图片铺满 + 一层带 opacity 的主题色遮罩"，真机上遮罩 opacity 一旦
 * 失效（如 Fabric 视图扁平化/透明度丢失），浅色背景图会原样透出，把夜间主题
 * 洗成灰白、白字对比度归零；现在任何一环失效，底色都仍是主题色。
 */
export function AppBackground({ style, children }: AppBackgroundProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const backgroundImageUri = useThemeStore((state) => state.backgroundImageUri);
  const backgroundOpacity = useThemeStore((state) => state.backgroundOpacity);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  // 夜间主题下遮罩不低于下限：亮色背景图透出过多会把浅色文字对比度压到不可读
  const resolvedTheme = getResolvedTheme(mode, systemTheme);
  const maskOpacity = getEffectiveBackgroundOpacity(resolvedTheme, backgroundOpacity);
  const imageOpacity = 1 - maskOpacity;

  return (
    <View style={[styles.root, { backgroundColor: palette.background }, style]}>
      {backgroundImageUri ? (
        <Image
          source={{ uri: backgroundImageUri }}
          style={[StyleSheet.absoluteFill, { opacity: imageOpacity }]}
          resizeMode="cover"
          onError={() => {
            // 图片加载失败时清空 URI，回落到纯背景色，避免长期显示破图
            void useThemeStore.getState().setBackgroundImageUri(null);
          }}
        />
      ) : null}
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
