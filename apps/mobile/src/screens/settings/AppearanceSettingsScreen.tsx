import React from "react";

import { SettingsPage } from "@/components/settings/SettingsPage";
import { ThemeModeCard } from "@/components/ThemeModeCard";

export function AppearanceSettingsScreen() {
  return (
    <SettingsPage title="外观" description="明暗模式、预设主题色与调色盘">
      <ThemeModeCard />
    </SettingsPage>
  );
}
