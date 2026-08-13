import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

interface SettingsLinkRowProps {
  title: string;
  subtitle: string;
  onPress: () => void;
}

export function SettingsLinkRow({ title, subtitle, onPress }: SettingsLinkRowProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <SettingsCard style={styles.rowCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        style={styles.row}
        onPress={onPress}
      >
        <View style={styles.copy}>
          <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>{subtitle}</Text>
        </View>
        <ChevronRight size={18} color={palette.primary} />
      </Pressable>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  rowCard: {
    paddingVertical: spacing.xs,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
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
  subtitle: {
    fontSize: typography.caption,
  },
});
