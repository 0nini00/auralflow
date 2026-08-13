import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

export function ExternalPlaybackSettings() {
  const loaded = usePlaybackSettingsStore((state) => state.loaded);
  const pause = usePlaybackSettingsStore((state) => state.pauseOnExternalPlayback);
  const load = usePlaybackSettingsStore((state) => state.loadFromStorage);
  const setPause = usePlaybackSettingsStore((state) => state.setPauseOnExternalPlayback);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  return (
    <SettingsCard style={styles.card}>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: palette.text }]}>其他应用播放音频时</Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>选择暂停当前歌曲或仅降低音量</Text>
      </View>
      <View style={[styles.options, { backgroundColor: palette.surfaceMuted }]}>
        {[
          { label: "暂停", value: true },
          { label: "降音量", value: false },
        ].map((option) => {
          const selected = pause === option.value;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => void setPause(option.value)}
              style={[styles.option, selected && { backgroundColor: palette.primary }]}
            >
              <Text style={[styles.optionText, { color: selected ? palette.primaryText : palette.textMuted }]}>
                {option.label}
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
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  title: { fontSize: typography.body, fontWeight: "600" },
  subtitle: { fontSize: typography.caption },
  options: { flexDirection: "row", borderRadius: radius.sm, padding: spacing.xxs },
  option: {
    minHeight: touch.minTarget,
    minWidth: 64,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: { fontSize: typography.caption, fontWeight: "700" },
});
