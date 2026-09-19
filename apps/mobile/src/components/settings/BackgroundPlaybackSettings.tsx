import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { BatteryCharging, ShieldCheck } from "lucide-react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import {
  isIgnoringBatteryOptimization,
  requestIgnoreBatteryOptimization,
} from "@/services/backgroundPlaybackService";
import { withAlpha } from "@/services/themePaletteModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

/**
 * 后台播放设置：电池优化白名单状态与授权入口。
 *
 * 这是「后台播一两首就停」的直接开关——国产 ROM 在未放行时会冻结进程，
 * 曲末 JS 无法加载下一首。非 Android 平台不做渲染。
 */
export function BackgroundPlaybackSettings() {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const refresh = useCallback(async () => {
    setGranted(await isIgnoringBatteryOptimization());
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void refresh();
    // 用户可能是从系统设置页返回时手动改的，回到前台就复查一次
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  if (Platform.OS !== "android") return null;

  const handleRequest = () => {
    setBusy(true);
    void requestIgnoreBatteryOptimization()
      .then(setGranted)
      .finally(() => setBusy(false));
  };

  const isGranted = granted === true;

  return (
    <SettingsCard style={styles.card}>
      <View style={styles.header}>
        <BatteryCharging size={18} color={palette.textSubtle} strokeWidth={2} />
        <Text style={[styles.title, { color: palette.text }]}>后台连续播放</Text>
      </View>
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>
        加入系统白名单可防止切到后台被系统冻结，保证锁屏与多任务连续播放。
      </Text>

      <View style={[styles.statusRow, { borderTopColor: palette.border }]}>
        <ShieldCheck size={16} color={isGranted ? palette.primary : palette.textMuted} />
        <Text
          style={[
            styles.statusText,
            { color: isGranted ? palette.primary : palette.textMuted },
          ]}
        >
          {granted == null
            ? "正在检查…"
            : isGranted
              ? "已加入白名单，后台播放不受系统限制"
              : "未加入白名单，后台播放可能被系统暂停"}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isGranted ? "重新检查后台播放权限" : "去设置后台播放权限"}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={isGranted ? () => void refresh() : handleRequest}
        style={({ pressed }) => [
          styles.action,
          {
            backgroundColor: withAlpha(palette.primary, 0.12),
            opacity: busy ? 0.6 : pressed ? 0.75 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={palette.primary} />
        ) : (
          <Text style={[styles.actionLabel, { color: palette.primary }]}>
            {isGranted ? "重新检查" : "去设置"}
          </Text>
        )}
      </Pressable>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.s,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  title: { fontSize: typography.title, fontWeight: "700" },
  subtitle: { fontSize: typography.caption, lineHeight: 18 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.s,
  },
  statusText: { fontSize: typography.caption, flex: 1, lineHeight: 18 },
  action: {
    minHeight: 44,
    borderRadius: radius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  actionLabel: { fontSize: typography.body, fontWeight: "600" },
});
