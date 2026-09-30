import React from "react";

import { CacheSettings } from "@/components/CacheSettings";
import { LogSettings } from "@/components/LogSettings";
import { SettingsPage } from "@/components/settings/SettingsPage";

export function DataSettingsScreen() {
  return (
    <SettingsPage title="存储与数据" description="查看缓存、下载、播放历史与运行日志">
      <CacheSettings />
      <LogSettings />
    </SettingsPage>
  );
}
