import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Volume2 } from "lucide-react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { withAlpha } from "@/services/themePaletteModel";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

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
      <View style={styles.header}>
        <Volume2 size={18} color={palette.textSubtle} strokeWidth={2} />
        <Text style={[styles.title, { color: palette.text }]}>其他应用播放音频时</Text>
      </View>
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>选择暂停当前歌曲或仅降低音量</Text>
      <View style={[styles.segmentGroup, { backgroundColor: palette.surfaceMuted }]}>
        {[
          { label: "暂停", value: true },
          { label: "降音量", value: false },
        ].map((option) => {
          const selected = pause === option.value;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="radio"
              accessibilityLabel={`其他应用播放音频时：${option.label}`}
              accessibilityState={{ selected }}
              onPress={() => void setPause(option.value)}
              style={({ pressed }) => [
                styles.segment,
                {
                  backgroundColor: selected ? withAlpha(palette.primary, 0.14) : "transparent",
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.segmentLabel, { color: selected ? palette.primary : palette.textMuted }]}>
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
    gap: spacing.s,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  title: { fontSize: typography.title, fontWeight: "700" },
  subtitle: { fontSize: typography.caption },
  segmentGroup: {
    flexDirection: "row",
    borderRadius: radius.md,
    padding: spacing.xxs,
  },
  segment: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.s,
  },
  segmentLabel: { fontSize: typography.body, fontWeight: "600" },
});
