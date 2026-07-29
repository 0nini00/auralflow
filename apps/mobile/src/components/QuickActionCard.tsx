import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CachedImage } from "@/components/CachedImage";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface QuickActionCardProps {
  title: string;
  subtitle: string;
  coverUri?: string | null;
  disabled?: boolean;
  onPress?: () => void;
}

export function QuickActionCard({ title, subtitle, coverUri, disabled, onPress }: QuickActionCardProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <Pressable
      style={[
        styles.quickCard,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
        disabled && [
          styles.quickCardDisabled,
          {
            backgroundColor: palette.surfaceMuted,
            borderColor: palette.border,
          },
        ],
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      {coverUri ? (
        <CachedImage uri={coverUri} style={styles.cover} fallback={<View style={[styles.cover, { backgroundColor: palette.surfaceMuted }]} />} />
      ) : null}
      <View style={styles.content}>
        <Text style={[styles.quickCardTitle, { color: disabled ? palette.textMuted : palette.text }]} numberOfLines={1}>{title}</Text>
        <Text style={[styles.quickCardSubtitle, { color: disabled ? palette.textSubtle : palette.textMuted }]} numberOfLines={2}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quickCard: {
    width: "48%",
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1a3a31",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a4a41",
  },
  quickCardDisabled: {
    backgroundColor: "#151f1c",
    borderColor: "#1a3a31",
    opacity: 0.5,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  quickCardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 4,
  },
  quickCardSubtitle: {
    fontSize: 12,
    color: "#8fa79f",
    lineHeight: 17,
  },
});
