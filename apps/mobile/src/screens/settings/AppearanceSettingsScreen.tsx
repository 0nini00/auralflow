import React from "react";

import { SettingsPage } from "@/components/settings/SettingsPage";
import { ThemeModeCard } from "@/components/ThemeModeCard";

export function AppearanceSettingsScreen() {
  return (
    <SettingsPage title="外观" description="主题与强调色">
      <ThemeModeCard />
    </SettingsPage>
  );
}
