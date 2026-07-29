import React from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ListFilter } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { DrawerNavigationProp } from "@react-navigation/drawer";

import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import type { SettingsDrawerParamList } from "@/navigation/types";
import { breakpoints, radius, spacing, touch, typography } from "@/theme/tokens";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

export interface SettingsPageProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function SettingsPage({ title, description, children }: SettingsPageProps) {
  const { width } = useWindowDimensions();
  const navigation = useNavigation<DrawerNavigationProp<SettingsDrawerParamList>>();
  const showCategoryButton = width < breakpoints.tablet;
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.container}>
        <SectionHeader
          title={title}
          description={description}
          action={showCategoryButton ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="打开设置分类"
              style={[styles.categoryButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
              onPress={() => navigation.openDrawer()}
            >
              <ListFilter size={18} color={palette.primary} />
              <Text style={[styles.categoryButtonText, { color: palette.primary }]}>分类</Text>
            </Pressable>
          ) : undefined}
        />
        <View style={styles.content}>{children}</View>
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.m },
  content: { gap: spacing.s },
  categoryButton: {
    minHeight: touch.minTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.s,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  categoryButtonText: {
    fontSize: typography.meta,
    fontWeight: "600",
  },
});
