import React from "react";
import { Image, InteractionManager, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";

import { Touchable } from "@/components/Touchable";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_ICONS,
} from "@/navigation/settingsRouteModel";
import { CURRENT_VERSION } from "@/services/updateService";
import { useSettingsCategoryStore } from "@/stores/settingsCategoryStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

const APP_VERSION = `v${CURRENT_VERSION}`;

export function DrawerContent({ navigation }: DrawerContentComponentProps) {
  const requestSettingsCategory = useSettingsCategoryStore((state) => state.requestCategory);
  const insets = useSafeAreaInsets();
  const mode = useThemeStore((store) => store.mode);
  const systemTheme = useThemeStore((store) => store.systemTheme);
  const accentColor = useThemeStore((store) => store.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const navigateAfterDrawerClose = (action: () => void) => {
    navigation.closeDrawer();
    InteractionManager.runAfterInteractions(action);
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: palette.surface,
          paddingTop: Math.max(insets.top, spacing.s),
          paddingBottom: Math.max(insets.bottom, spacing.s),
        },
      ]}
    >
      <View style={[styles.brand, { borderBottomColor: palette.border }]}>
        <Image
          source={require("../assets/logo.png")}
          style={styles.logoImage}
          accessibilityRole="image"
          accessibilityLabel="AuralFlow"
        />
        <Text style={[styles.brandText, { color: palette.text }]}>AuralFlow</Text>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.textSubtle }]}>设置</Text>
          {SETTINGS_CATEGORIES.map((category) => {
            const Icon = SETTINGS_CATEGORY_ICONS[category.icon];
            return (
              <Touchable
                key={category.name}
                style={styles.item}
                activeScale={0.98}
                activeOpacity={0.78}
                onPress={() =>
                  navigateAfterDrawerClose(() => {
                    // 分类请求写入 store（(分类, navId) 递增），设置堆栈据此整体
                    // 重挂载。不走路由 params：嵌套 navigate 的 {screen} 会被
                    // react-navigation 解释为进入内部堆栈，参数合并导致外部读不到
                    // 最新目标，表现为「退出后点另一个分类仍显示上一个页面」。
                    requestSettingsCategory(category.name);
                    navigation.navigate("Settings");
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${category.label}，${category.description}`}
              >
                <View style={styles.itemInner}>
                  <Icon size={22} color={palette.primary} strokeWidth={2} />
                  <View style={styles.itemCopy}>
                    <Text style={[styles.itemText, { color: palette.text }]} numberOfLines={1}>
                      {category.label}
                    </Text>
                    <Text
                      style={[styles.itemDescription, { color: palette.textMuted }]}
                      numberOfLines={1}
                    >
                      {category.description}
                    </Text>
                  </View>
                </View>
              </Touchable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: palette.border }]} accessibilityRole="text">
        <Text style={[styles.version, { color: palette.textSubtle }]}>{APP_VERSION}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logoImage: { width: 32, height: 32, borderRadius: radius.sm },
  brandText: { fontSize: typography.heading, fontWeight: "700" },
  content: { flex: 1 },
  contentContainer: { paddingBottom: spacing.s },
  section: { paddingTop: spacing.xs, paddingBottom: spacing.xs },
  sectionTitle: {
    paddingHorizontal: spacing.m,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxs,
    fontSize: typography.caption,
    fontWeight: "600",
  },
  item: { marginHorizontal: spacing.xs, borderRadius: radius.sm },
  itemInner: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
  },
  itemCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  itemText: { fontSize: typography.body, fontWeight: "600" },
  itemDescription: { fontSize: typography.caption },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
    alignItems: "center",
  },
  version: { fontSize: typography.caption },
});
