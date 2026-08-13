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
  /** 让卡片在 flex 行里伸展占满剩余空间（我的页单卡时全宽展示） */
  grow?: boolean;
}

export function QuickActionCard({ title, subtitle, coverUri, disabled, onPress, grow }: QuickActionCardProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  return (
    <Pressable
      style={[
        styles.quickCard,
        grow && styles.quickCardGrow,
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
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickCardGrow: {
    flexGrow: 1,
  },
  quickCardDisabled: {
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
    marginBottom: 4,
  },
  quickCardSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
});
