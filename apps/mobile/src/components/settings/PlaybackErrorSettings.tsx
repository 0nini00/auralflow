import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { Chip } from "@/components/ui/Chip";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

export function PlaybackErrorSettings() {
  const loaded = usePlaybackSettingsStore((state) => state.loaded);
  const autoSkip = usePlaybackSettingsStore((state) => state.autoSkipOnPlaybackError);
  const load = usePlaybackSettingsStore((state) => state.loadFromStorage);
  const setAutoSkip = usePlaybackSettingsStore((state) => state.setAutoSkipOnPlaybackError);
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
        <Text style={[styles.title, { color: palette.text }]}>播放失败时</Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          选择暂停并显示错误或自动尝试播放下一首
        </Text>
      </View>
      <View style={[styles.options, { backgroundColor: palette.surfaceMuted }]}>
        {[
          { label: "暂停", value: false },
          { label: "下一首", value: true },
        ].map((option) => {
          const selected = autoSkip === option.value;
          return (
            <Chip
              key={option.label}
              label={option.label}
              selected={selected}
              onPress={() => void setAutoSkip(option.value)}
              style={styles.option}
            />
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
    minWidth: 64,
  },
});
