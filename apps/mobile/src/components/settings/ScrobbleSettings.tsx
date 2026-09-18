import React, { useEffect } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { Activity } from "lucide-react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { usePlaybackSettingsStore } from "@/stores/playbackSettingsStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing, typography } from "@/theme/tokens";

export function ScrobbleSettings() {
  const loaded = usePlaybackSettingsStore((state) => state.loaded);
  const enableScrobble = usePlaybackSettingsStore((state) => state.enableScrobble);
  const load = usePlaybackSettingsStore((state) => state.loadFromStorage);
  const setEnableScrobble = usePlaybackSettingsStore((state) => state.setEnableScrobble);

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
        <Activity size={18} color={palette.textSubtle} strokeWidth={2} />
        <Text style={[styles.title, { color: palette.text }]}>听歌统计与打点</Text>
      </View>
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>
        连续播放满 2 分钟或 50% 时计入播放历史（避免误触刷榜）
      </Text>
      <View style={[styles.row, { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
        <View style={styles.rowInfo}>
          <Text style={[styles.rowTitle, { color: palette.text }]}>同步听歌量到网易云</Text>
          <Text style={[styles.rowDesc, { color: palette.textMuted }]}>
            已登录时向网易云上报真实播放时长，用于年度歌单与推荐
          </Text>
        </View>
        <Switch
          value={enableScrobble}
          onValueChange={(val) => void setEnableScrobble(val)}
          trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
          thumbColor="#FFFFFF"
          accessibilityLabel="同步听歌量到网易云开关"
        />
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
  title: {
    fontSize: typography.title,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: typography.caption,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.m,
    marginTop: spacing.xs,
    gap: spacing.m,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: typography.body,
    fontWeight: "500",
  },
  rowDesc: {
    fontSize: typography.caption,
  },
});
