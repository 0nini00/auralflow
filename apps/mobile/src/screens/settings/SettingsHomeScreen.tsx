import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { Touchable } from "@/components/Touchable";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_ICONS,
  type SettingsCategoryName,
} from "@/navigation/settingsRouteModel";
import { useSettingsCategoryStore } from "@/stores/settingsCategoryStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

/**
 * 设置首页 —— 对齐首页「快捷入口」的 2 列卡片宫格。
 * 每项卡片：主色图标 + 名称 + 一行描述。
 */
export function SettingsHomeScreen() {
  const requestCategory = useSettingsCategoryStore((state) => state.requestCategory);
  const openCategory = (name: SettingsCategoryName) => {
    // 写入分类请求即切换页面（设置区无导航栈，纯组件渲染）
    requestCategory(name);
  };
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.container}>
        <View style={styles.grid}>
          {SETTINGS_CATEGORIES.map((category) => {
            const Icon = SETTINGS_CATEGORY_ICONS[category.icon];
            return (
              <Touchable
                key={category.name}
                accessibilityRole="button"
                accessibilityLabel={`${category.label}，${category.description}`}
                onPress={() => openCategory(category.name)}
                style={[
                  styles.card,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                  },
                ]}
              >
                <View style={[styles.iconChip, { backgroundColor: palette.surfaceStrong }]}>
                  <Icon size={22} color={palette.primary} />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.title, { color: palette.text }]}>{category.label}</Text>
                  <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={2}>
                    {category.description}
                  </Text>
                </View>
              </Touchable>
            );
          })}
        </View>
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: spacing.xs },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s,
  },
  card: {
    width: "48.5%",
    minHeight: 108,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.s,
    gap: spacing.s,
  },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  title: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  description: {
    fontSize: typography.caption,
    lineHeight: 16,
  },
});
