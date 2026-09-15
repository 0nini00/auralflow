import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Check, Music2 } from "lucide-react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { getPlaybackQualityLabel, PLAYBACK_QUALITY_OPTIONS } from "@/services/playbackQualityModel";
import { withAlpha } from "@/services/themePaletteModel";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing, typography } from "@/theme/tokens";

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
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>
        当前：{qualityLabel} · 用于在线播放和新建下载任务
      </Text>
      <View>
        {PLAYBACK_QUALITY_OPTIONS.map((option, index) => {
          const selected = quality === option.value;
          return (
            <View key={option.value}>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={`默认音质，${option.label}，${option.description}`}
                accessibilityState={{ selected }}
                onPress={() => void setQuality(option.value)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: selected ? withAlpha(palette.primary, 0.1) : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Music2 size={18} color={selected ? palette.primary : palette.textSubtle} strokeWidth={2} />
                <View style={styles.rowCopy}>
                  <Text style={[styles.rowLabel, { color: palette.text }]} numberOfLines={1}>
                    {option.label}
                  </Text>
                  <Text style={[styles.rowDescription, { color: palette.textMuted }]} numberOfLines={1}>
                    {option.description}
                  </Text>
                </View>
                {selected ? <Check size={18} color={palette.primary} strokeWidth={2} /> : null}
              </Pressable>
              {index < PLAYBACK_QUALITY_OPTIONS.length - 1 ? (
                <View style={[styles.hairline, { backgroundColor: palette.border }]} />
              ) : null}
            </View>
          );
        })}
      </View>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
  },
  title: { fontSize: typography.title, fontWeight: "700" },
  subtitle: { fontSize: typography.caption },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    paddingHorizontal: spacing.m,
    gap: spacing.s,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  rowLabel: { fontSize: typography.body, fontWeight: "600" },
  rowDescription: { fontSize: typography.caption },
  hairline: { height: StyleSheet.hairlineWidth },
});
