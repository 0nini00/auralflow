import React from "react";

import { AppBackgroundCard } from "@/components/AppBackgroundCard";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { ThemeModeCard } from "@/components/ThemeModeCard";

export function AppearanceSettingsScreen() {
  return (
    <SettingsPage title="外观" description="主题、强调色与应用背景">
      <ThemeModeCard />
      <AppBackgroundCard />
    </SettingsPage>
  );
}
