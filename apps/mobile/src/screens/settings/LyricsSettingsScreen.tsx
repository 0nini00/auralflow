import React from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";

import { LyricSettingsContent } from "@/screens/LyricSettingsScreen";
import { LyricOverlaySettings } from "@/components/settings/LyricOverlaySettings";
import { SectionHeader } from "@/components/SectionHeader";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { useLyricSettingsStore } from "@/stores/lyricSettingsStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing } from "@/theme/tokens";

export function LyricsSettingsScreen() {
  const resetSettings = useLyricSettingsStore((s) => s.resetSettings);
  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const confirmReset = () => {
    Alert.alert("恢复默认样式", "确定恢复沉浸歌词默认样式吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "恢复",
        style: "destructive",
        onPress: () => {
          void resetSettings();
          Alert.alert("已恢复", "歌词样式已恢复为默认设置");
        },
      },
    ]);
  };

  return (
    <SettingsPage title="歌词" description="沉浸歌词样式与悬浮歌词">
      <SectionHeader title="悬浮歌词" description="在其他应用上层展示当前歌词" />
      <LyricOverlaySettings />
      <SectionHeader
        title="沉浸歌词"
        description="全屏播放页的歌词样式与播放行为"
        action={
          <Pressable
            onPress={confirmReset}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="恢复默认歌词样式"
          >
            <Text style={[styles.resetLink, { color: palette.primary }]}>恢复默认</Text>
          </Pressable>
        }
      />
      <LyricSettingsContent />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  resetLink: {
    fontSize: 13,
    fontWeight: "700",
    minHeight: 32,
    textAlignVertical: "center",
  },
});
