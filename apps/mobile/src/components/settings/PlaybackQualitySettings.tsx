import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { getPlaybackQualityLabel, PLAYBACK_QUALITY_OPTIONS } from "@/services/playbackQualityModel";
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
  const qualityLabel = getPlaybackQualityLabel(quality);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  return (
    <SettingsCard style={styles.card}>
      <Text style={[styles.title, { color: palette.text }]}>默认音质</Text>
      <Text style={[styles.summary, { color: palette.textMuted }]}>当前：{qualityLabel}</Text>
      <Text style={[styles.description, { color: palette.textMuted }]}>用于在线播放和新建下载任务</Text>
      <View style={styles.grid}>
        {PLAYBACK_QUALITY_OPTIONS.map((option) => {
          const selected = quality === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`默认音质，${option.label}，${option.description}`}
              accessibilityHint="用于在线播放和新建下载任务"
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
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.s,
  },
  title: { fontSize: typography.body, fontWeight: "600" },
  summary: { fontSize: typography.meta, fontWeight: "600" },
  description: { fontSize: typography.caption },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  option: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 120,
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
