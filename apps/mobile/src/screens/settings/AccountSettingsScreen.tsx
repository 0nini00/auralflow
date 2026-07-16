import React from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { AccountInfo } from "@/components/AccountInfo";
import { BiliAccountCard } from "@/components/settings/BiliAccountCard";
import { SettingsPage } from "@/components/settings/SettingsPage";
import type { SettingsStackParamList } from "@/navigation/types";

export function AccountSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  return (
    <SettingsPage title="账号" description="管理网易云与 B站登录状态">
      <AccountInfo onLoginPress={() => navigation.navigate("Login")} />
      <BiliAccountCard />
    </SettingsPage>
  );
}
