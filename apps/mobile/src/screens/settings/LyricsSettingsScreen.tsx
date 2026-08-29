import React from "react";
import { StyleSheet } from "react-native";

import { LyricSettingsContent } from "@/screens/LyricSettingsScreen";
import { LyricOverlaySettings } from "@/components/settings/LyricOverlaySettings";
import { SectionHeader } from "@/components/SectionHeader";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { spacing } from "@/theme/tokens";

export function LyricsSettingsScreen() {
  return (
    <SettingsPage title="歌词" description="沉浸歌词样式与悬浮歌词">
      <SectionHeader title="悬浮歌词" description="在其他应用上层的桌面歌词窗口" style={styles.groupHeader} />
      <LyricOverlaySettings />
      <SectionHeader title="沉浸歌词" description="全屏播放页的歌词样式" style={styles.groupHeader} />
      <LyricSettingsContent onBack={() => {}} showNavigation={false} />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  groupHeader: { marginTop: spacing.s },
});
