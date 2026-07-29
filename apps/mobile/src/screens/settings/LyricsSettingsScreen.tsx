import React from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { LyricOverlaySettings } from "@/components/settings/LyricOverlaySettings";
import { SettingsLinkRow } from "@/components/settings/SettingsLinkRow";
import { SettingsPage } from "@/components/settings/SettingsPage";
import type { SettingsStackParamList } from "@/navigation/types";

export function LyricsSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  return (
    <SettingsPage title="歌词" description="沉浸歌词、译文和悬浮歌词">
      <SettingsLinkRow
        title="歌词样式"
        subtitle="字号、行距、颜色、译文与字体"
        onPress={() => navigation.navigate("LyricDetail")}
      />
      <LyricOverlaySettings />
    </SettingsPage>
  );
}
