import React, { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { SettingsLinkRow } from "@/components/settings/SettingsLinkRow";
import { SettingsPage } from "@/components/settings/SettingsPage";
import type { SettingsStackParamList } from "@/navigation/types";
import { useCustomSourceStore } from "@/stores/customSourceStore";

export function SourcesSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const sources = useCustomSourceStore((state) => state.sources);
  const loaded = useCustomSourceStore((state) => state.loaded);
  const load = useCustomSourceStore((state) => state.loadFromStorage);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  return (
    <SettingsPage title="音源" description="导入、测试和更新自定义音源">
      <SettingsLinkRow
        title="自定义音源"
        subtitle={sources.length > 0 ? `${sources.length} 个音源` : "导入 LX Music 音源脚本"}
        onPress={() => navigation.navigate("CustomSources")}
      />
    </SettingsPage>
  );
}
