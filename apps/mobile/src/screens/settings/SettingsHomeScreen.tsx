import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SettingsRow } from "@/components/settings/SettingsRow";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_ICONS,
  type SettingsCategoryName,
} from "@/navigation/settingsRouteModel";
import { useSettingsCategoryStore } from "@/stores/settingsCategoryStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

const SETTINGS_GROUPS: readonly { title: string; items: readonly SettingsCategoryName[] }[] = [
  { title: "账号", items: ["Account"] },
  { title: "播放与外观", items: ["Playback", "Lyrics", "Appearance"] },
  { title: "音源与同步", items: ["Sources", "Sync"] },
  { title: "数据与关于", items: ["Data", "About"] },
] as const;

/**
 * 设置首页 —— 分组行列表（8 类设置）。
 *
 * 与「我的」的分工：我的只放账号、快捷入口与服务；设置页负责所有开关。
 * 分类切换走 settingsCategoryStore，不依赖嵌套导航栈。
 */
export function SettingsHomeScreen() {
  const requestCategory = useSettingsCategoryStore((state) => state.requestCategory);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.container}>
        {SETTINGS_GROUPS.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text style={[styles.groupTitle, { color: palette.textMuted }]}>{group.title}</Text>
            <View
              style={[
                styles.card,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              {group.items.map((name) => {
                const category = SETTINGS_CATEGORIES.find((item) => item.name === name);
                if (!category) return null;
                const Icon = SETTINGS_CATEGORY_ICONS[category.icon];
                return (
                  <SettingsRow
                    key={name}
                    icon={Icon}
                    title={category.label}
                    description={category.description}
                    onPress={() => requestCategory(name, { fromSettingsHome: true })}
                  />
                );
              })}
            </View>
          </View>
        ))}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
  },
  group: {
    marginBottom: spacing.l,
  },
  groupTitle: {
    marginBottom: spacing.xs,
    marginLeft: spacing.xxs,
    fontSize: typography.micro,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
