import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Radio } from "lucide-react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { withAlpha } from "@/services/themePaletteModel";
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
      <View style={styles.header}>
        <Radio size={18} color={palette.textSubtle} strokeWidth={2} />
        <Text style={[styles.title, { color: palette.text }]}>播放失败时</Text>
      </View>
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>
        单曲播放遇到网络或音源失效时的处置策略
      </Text>
      <View style={[styles.segmentGroup, { backgroundColor: palette.surfaceMuted }]}>
        {[
          { label: "暂停", value: false },
          { label: "自动跳过", value: true },
        ].map((option) => {
          const selected = autoSkip === option.value;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="radio"
              accessibilityLabel={`播放失败时：${option.label}`}
              accessibilityState={{ selected }}
              onPress={() => void setAutoSkip(option.value)}
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
