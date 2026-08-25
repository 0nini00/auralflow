import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsLinkRow } from "@/components/settings/SettingsLinkRow";
import { UpdateModal } from "@/components/UpdateModal";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { getUpdateCheckStatus } from "@/services/updateCheckModel";
import { CURRENT_VERSION, checkForUpdates, type UpdateInfo } from "@/services/updateService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

export function AboutSettingsScreen() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  const handleCheck = async () => {
    setChecking(true);
    setStatus("检查中…");
    try {
      const info = await checkForUpdates();
      setStatus(getUpdateCheckStatus(info));
      setUpdateInfo(info.hasUpdate ? info : null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setUpdateInfo(null);
    } finally {
      setChecking(false);
    }
  };

  return (
    <SettingsPage title="关于" description="应用版本与软件更新">
      <SettingsCard style={styles.card}>
        <View style={[styles.row, styles.rowDivider, { borderBottomColor: palette.border }]}>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: palette.text }]}>当前版本</Text>
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>AuralFlow Mobile {CURRENT_VERSION}</Text>
          </View>
        </View>
        <SettingsLinkRow
          title="软件更新"
          subtitle={status || "检查 GitHub Releases 最新版本"}
          subtitleAccent={!!status}
          onPress={() => void handleCheck()}
          disabled={checking}
          trailing={
            checking ? <ActivityIndicator color={palette.primary} /> : undefined
          }
        />
      </SettingsCard>
      {updateInfo ? <UpdateModal visible info={updateInfo} onClose={() => setUpdateInfo(null)} /> : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: spacing.xs,
    gap: 0,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  title: { fontSize: typography.body, fontWeight: "600" },
  subtitle: { fontSize: typography.caption },
  action: { fontSize: typography.meta, fontWeight: "700" },
});
