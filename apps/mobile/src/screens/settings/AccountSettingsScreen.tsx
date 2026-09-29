import React from "react";

import { NeteaseAccountCard } from "@/components/settings/NeteaseAccountCard";
import { SettingsPage } from "@/components/settings/SettingsPage";

export function AccountSettingsScreen() {
  return (
    <SettingsPage title="账号与服务" description="管理网易云登录状态">
      <NeteaseAccountCard />
    </SettingsPage>
  );
}
