import React from "react";

import { BiliAccountCard } from "@/components/settings/BiliAccountCard";
import { NeteaseAccountCard } from "@/components/settings/NeteaseAccountCard";
import { SettingsPage } from "@/components/settings/SettingsPage";

export function AccountSettingsScreen() {
  return (
    <SettingsPage title="账号与服务" description="管理网易云与 B站登录状态">
      <NeteaseAccountCard />
      <BiliAccountCard />
    </SettingsPage>
  );
}
