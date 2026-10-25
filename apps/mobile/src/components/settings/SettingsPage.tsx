import React, { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";

import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import {
  SettingsScrollContext,
  type SettingsScrollController,
  type SettingsScrollMetrics,
} from "@/components/settings/SettingsScrollContext";
import { spacing, typography } from "@/theme/tokens";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

export interface SettingsPageProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

/**
 * 设置二级页统一脚手架。
 * 导航栏已有页面标题，页内不再重复大标题，只保留一行简短说明（首页风格的小字描述），
 * 内容以 SettingsCard 卡片排列。
 *
 * 同时向页内提供滚动控制面：卡片拖拽排序期间锁滚动、按滚动量折算拖拽位移、
 * 拖到边缘时程序化滚页。
 */
export function SettingsPage({ title, description, children }: SettingsPageProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const [scrollLocked, setScrollLocked] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const viewportRef = useRef<View>(null);
  const scrollOffset = useSharedValue(0);
  const metrics = useSharedValue<SettingsScrollMetrics>({
    top: 0,
    height: 0,
    contentHeight: 0,
  });

  const controller = useMemo<SettingsScrollController>(() => ({
    scrollOffset,
    metrics,
    lock: setScrollLocked,
    scrollTo: (y) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: false });
    },
  }), [scrollOffset, metrics]);

  const measureViewport = useCallback(() => {
    viewportRef.current?.measureInWindow((_x, y, _width, height) => {
      metrics.value = { ...metrics.value, top: y, height };
    });
  }, [metrics]);

  return (
    <ScreenScaffold>
      <View
        ref={viewportRef}
        style={styles.viewport}
        collapsable={false}
        onLayout={measureViewport}
      >
        <SettingsScrollContext.Provider value={controller}>
          <ScreenScrollView
            innerRef={scrollRef}
            accessibilityLabel={`${title}，${description}`}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!scrollLocked}
            scrollEventThrottle={16}
            onScroll={(event) => {
              scrollOffset.value = event.nativeEvent.contentOffset.y;
            }}
            onContentSizeChange={(_width, height) => {
              metrics.value = { ...metrics.value, contentHeight: height };
            }}
          >
            <Text accessibilityRole="summary" style={[styles.description, { color: palette.textMuted }]}>
              {description}
            </Text>
            <View style={styles.content}>{children}</View>
          </ScreenScrollView>
        </SettingsScrollContext.Provider>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, minWidth: 0 },
  container: { gap: spacing.m, paddingBottom: spacing.s },
  description: {
    fontSize: typography.body,
    lineHeight: 20,
  },
  content: { gap: spacing.m },
});
