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
    <SettingsPage title="音源" description="内置网关解析播放地址；自定义音源作为播放兜底">
      <CustomSourceScreen />
    </SettingsPage>
  );
}
