import React from "react";

import { CacheSettings } from "@/components/CacheSettings";
import { SettingsPage } from "@/components/settings/SettingsPage";

export function DataSettingsScreen() {
  return (
    <SettingsPage title="数据" description="查看并清理缓存与播放历史">
      <CacheSettings />
    </SettingsPage>
  );
}
