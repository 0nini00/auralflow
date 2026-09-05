import React from "react";
import { Image, StyleSheet, View, type ViewStyle } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface AppBackgroundProps {
  style?: ViewStyle;
  children: React.ReactNode;
}

/**
 * 应用最外层背景层。与桌面端对齐：当用户设置了自定义背景图时，直接显示在主题色底色上，
 * 不做模糊处理或遮罩调节。未设置时降级为纯背景色。
 *
 * 结构说明：底色必须是**不透明纯色 View**，背景图铺在上面。此前有遮罩不透明度调节，
 * 真机上遮罩 opacity 一旦失效（如 Fabric 视图扁平化/透明度丢失），浅色背景图会原样
 * 透出，把夜间主题洗成灰白、白字对比度归零；现在任何一环失效，底色都仍是主题色。
 */
export function AppBackground({ style, children }: AppBackgroundProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const backgroundImageUri = useThemeStore((state) => state.backgroundImageUri);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <View style={[styles.root, { backgroundColor: palette.background }, style]}>
      {backgroundImageUri ? (
        <Image
          source={{ uri: backgroundImageUri }}
          style={StyleSheet.absoluteFill}
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
