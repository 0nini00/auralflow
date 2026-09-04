import React from "react";
import { Image, StyleSheet, View, type ViewStyle } from "react-native";

import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface AppBackgroundProps {
  style?: ViewStyle;
  children: React.ReactNode;
}

/**
 * 应用最外层背景层。与桌面端对齐(桌面:背景图 + 面板半透明 + backdrop-filter blur)。
 *
 * RN 无 backdrop-filter,且 @react-native-community/blur 的 BlurView 是「前景模糊层」,
 * 盖不住滚动列表、新架构下 Android 还有 PreDrawBlurController 崩溃隐患;而桌面毛玻璃
 * 模糊的对象是静态背景图 → 图不变、模糊结果不变。因此这里用 RN 内置 Image blurRadius
 * 预模糊背景图,内容容器层用半透明透出它——视觉等价毛玻璃,零原生依赖。
 *
 * 结构说明:底色仍是**不透明纯色 View**(降级兜底)。有背景图时其上铺一张 blurRadius
 * 预模糊的图,再叠一层主题色半透明蒙层压暗以保证文字可读。任何一环失效(如真机 Fabric
 * 下 opacity 丢失),最底层不透明底色仍在,不会把夜间主题洗白。
 */
export function AppBackground({ style, children }: AppBackgroundProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const backgroundImageUri = useThemeStore((state) => state.backgroundImageUri);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const resolvedTheme = getResolvedTheme(mode, systemTheme);
  const isDark = resolvedTheme === "dark";

  return (
    <View style={[styles.root, { backgroundColor: palette.background }, style]}>
      {backgroundImageUri ? (
        <>
          {/* 预模糊背景图:blurRadius 是 RN 内置,Android/iOS 均原生实现,无新依赖 */}
          <Image
            source={{ uri: backgroundImageUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            blurRadius={24}
            onError={() => {
              // 图片加载失败时清空 URI,回落到纯背景色,避免长期显示破图
              void useThemeStore.getState().setBackgroundImageUri(null);
            }}
          />
          {/* 主题色蒙层:压暗背景保证前景文字可读;深色更狠、浅色更轻。 */}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? "rgba(10, 10, 14, 0.5)" : "rgba(250, 250, 252, 0.28)" },
            ]}
          />
        </>
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
