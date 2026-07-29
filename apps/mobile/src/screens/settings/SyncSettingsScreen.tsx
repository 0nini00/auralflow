import React, { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { SettingsLinkRow } from "@/components/settings/SettingsLinkRow";
import { SettingsPage } from "@/components/settings/SettingsPage";
import type { SettingsStackParamList } from "@/navigation/types";
import { useWebdavStore } from "@/stores/webdavStore";

export function SyncSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const loaded = useWebdavStore((state) => state.loaded);
  const url = useWebdavStore((state) => state.url);
  const load = useWebdavStore((state) => state.loadConfig);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  return (
    <SettingsPage title="同步" description="通过 WebDAV 同步歌单和音源">
      <SettingsLinkRow
        title="WebDAV 同步"
        subtitle={url ? "已配置同步地址" : "配置歌单和音源同步"}
        onPress={() => navigation.navigate("WebDav")}
      />
    </SettingsPage>
  );
}
