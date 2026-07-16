import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import {
  CircleUserRound,
  Database,
  Info,
  Mic2,
  Palette,
  RadioTower,
  SlidersHorizontal,
  Volume2,
  type LucideIcon,
} from "lucide-react-native";

import { Touchable } from "@/components/Touchable";
import { SETTINGS_CATEGORIES, type SettingsCategoryName } from "@/navigation/settingsRouteModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

const ICONS: Record<(typeof SETTINGS_CATEGORIES)[number]["icon"], LucideIcon> = {
  account: CircleUserRound,
  appearance: Palette,
  playback: Volume2,
  sources: RadioTower,
  lyrics: Mic2,
  sync: SlidersHorizontal,
  data: Database,
  about: Info,
};

export function SettingsDrawerContent(props: DrawerContentComponentProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const activeRoute = props.state.routes[props.state.index]?.name as SettingsCategoryName;

  return (
    <View style={[styles.root, { backgroundColor: palette.surface }]}> 
      <View style={[styles.header, { borderBottomColor: palette.border }]}> 
        <Text style={[styles.title, { color: palette.text }]}>设置分类</Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>按桌面端结构分组</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {SETTINGS_CATEGORIES.map((category) => {
          const selected = activeRoute === category.name;
          const Icon = ICONS[category.icon];
          return (
            <Touchable
              key={category.name}
              accessibilityRole="button"
              accessibilityLabel={category.label}
              accessibilityState={{ selected }}
              onPress={() => props.navigation.navigate(category.name)}
              style={[
                styles.item,
                selected && { backgroundColor: palette.surfaceMuted },
              ]}
            >
              <View style={[styles.indicator, selected && { backgroundColor: palette.primary }]} />
              <Icon size={18} color={selected ? palette.primary : palette.textMuted} />
              <View style={styles.itemCopy}>
                <Text style={[styles.itemLabel, { color: selected ? palette.text : palette.textMuted }]}>
                  {category.label}
                </Text>
                <Text style={[styles.itemDescription, { color: palette.textSubtle }]} numberOfLines={1}>
                  {category.description}
                </Text>
              </View>
            </Touchable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xxs,
  },
  title: { fontSize: typography.title, fontWeight: "700" },
  subtitle: { fontSize: typography.caption },
  list: { padding: spacing.xs, gap: spacing.xxs },
  item: {
    minHeight: touch.minTarget,
    borderRadius: radius.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingRight: spacing.xs,
  },
  indicator: { width: 3, alignSelf: "stretch", backgroundColor: "transparent" },
  itemCopy: { flex: 1, minWidth: 0 },
  itemLabel: { fontSize: typography.body, fontWeight: "600" },
  itemDescription: { fontSize: typography.caption },
});
