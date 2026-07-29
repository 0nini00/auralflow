import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { UpdateModal } from "@/components/UpdateModal";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { getUpdateCheckStatus } from "@/services/updateCheckModel";
import { CURRENT_VERSION, checkForUpdates, type UpdateInfo } from "@/services/updateService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

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
    setStatus("检查中...");
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
      <View style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: palette.text }]}>当前版本</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>AuralFlow Mobile {CURRENT_VERSION}</Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="检查更新"
        disabled={checking}
        onPress={() => void handleCheck()}
        style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <View style={styles.copy}>
          <Text style={[styles.title, { color: palette.text }]}>软件更新</Text>
          <Text style={[styles.subtitle, { color: status ? palette.primary : palette.textMuted }]}>
            {status || "检查 GitHub Releases 最新版本"}
          </Text>
        </View>
        {checking ? <ActivityIndicator color={palette.primary} /> : <Text style={[styles.action, { color: palette.primary }]}>检查</Text>}
      </Pressable>
      {updateInfo ? <UpdateModal visible info={updateInfo} onClose={() => setUpdateInfo(null)} /> : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  title: { fontSize: typography.body, fontWeight: "600" },
  subtitle: { fontSize: typography.caption },
  action: { fontSize: typography.meta, fontWeight: "700" },
});
