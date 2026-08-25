import React from "react";

import { LyricSettingsContent } from "@/screens/LyricSettingsScreen";
import { LyricOverlaySettings } from "@/components/settings/LyricOverlaySettings";
import { SettingsPage } from "@/components/settings/SettingsPage";

export function LyricsSettingsScreen() {
  return (
    <SettingsPage title="歌词" description="沉浸歌词样式与悬浮歌词">
      <LyricOverlaySettings />
      <LyricSettingsContent onBack={() => {}} showNavigation={false} />
    </SettingsPage>
  );
}
