import React, { useEffect } from "react";

import { WebDavSyncScreen } from "@/screens/WebDavSyncScreen";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { useWebdavStore } from "@/stores/webdavStore";

export function SyncSettingsScreen() {
  const loaded = useWebdavStore((state) => state.loaded);
  const load = useWebdavStore((state) => state.loadConfig);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  return (
    <SettingsPage title="同步与备份" description="通过 WebDAV 同步歌单和音源">
      <WebDavSyncScreen />
    </SettingsPage>
  );
}
