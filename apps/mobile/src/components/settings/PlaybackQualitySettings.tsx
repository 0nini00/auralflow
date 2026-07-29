import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PLAYBACK_QUALITY_OPTIONS } from "@/services/playbackQualityModel";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

export function PlaybackQualitySettings() {
  const loaded = usePlaybackSettingsStore((state) => state.loaded);
  const quality = usePlaybackSettingsStore((state) => state.defaultQuality);
  const load = usePlaybackSettingsStore((state) => state.loadFromStorage);
  const setQuality = usePlaybackSettingsStore((state) => state.setDefaultQuality);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.title, { color: palette.text }]}>默认播放音质</Text>
      <View style={styles.grid}>
        {PLAYBACK_QUALITY_OPTIONS.map((option) => {
          const selected = quality === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => void setQuality(option.value)}
              style={[
                styles.option,
                {
                  backgroundColor: selected ? palette.primary : palette.surfaceMuted,
                  borderColor: selected ? palette.primary : palette.border,
                },
              ]}
            >
              <Text style={[styles.optionTitle, { color: selected ? palette.primaryText : palette.text }]}>
                {option.label}
              </Text>
              <Text style={[styles.optionDescription, { color: selected ? palette.primaryText : palette.textMuted }]}>
                {option.description}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.s,
    gap: spacing.s,
  },
  title: { fontSize: typography.body, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  option: {
    width: "48%",
    minHeight: touch.minTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: spacing.xs,
    justifyContent: "center",
    gap: spacing.xxs,
  },
  optionTitle: { fontSize: typography.body, fontWeight: "700" },
  optionDescription: { fontSize: typography.caption },
});
