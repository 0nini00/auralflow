import React, { useEffect } from "react";

import { CustomSourceScreen } from "@/screens/CustomSourceScreen";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { useCustomSourceStore } from "@/stores/customSourceStore";

export function SourcesSettingsScreen() {
  const loaded = useCustomSourceStore((state) => state.loaded);
  const load = useCustomSourceStore((state) => state.loadFromStorage);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  return (
    <SettingsPage title="音源" description="自定义音源管理；内置音源作为备用解析">
      <CustomSourceScreen />
    </SettingsPage>
  );
}
