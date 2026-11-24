import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { ChevronRight, FolderOpen } from "lucide-react-native";

import { Touchable } from "@/components/Touchable";
import {
  clearDownloadDirectory,
  loadDownloadDirectory,
  pickDownloadDirectory,
  type DownloadDirectory,
} from "@/services/downloadDirectoryService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

/** 下载页顶部的下载位置设置：默认只保存到应用内。 */
export function DownloadDirectoryRow() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const [directory, setDirectory] = useState<DownloadDirectory | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void loadDownloadDirectory().then((value) => {
      if (active) setDirectory(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const choose = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await pickDownloadDirectory();
      if (picked) setDirectory(picked);
    } catch (error) {
      Alert.alert("选择文件夹失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearDownloadDirectory();
      setDirectory(null);
    } catch (error) {
      Alert.alert("恢复默认失败", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Touchable
        style={styles.main}
        onPress={choose}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="选择下载文件夹"
      >
        <FolderOpen size={20} color={palette.primaryInk} />
        <Text style={[styles.title, { color: palette.text }]}>下载位置</Text>
        <Text style={[styles.value, { color: palette.textMuted }]} numberOfLines={1}>
          {directory ? directory.name : "默认（应用内）"}
        </Text>
        {busy ? (
          <ActivityIndicator size="small" color={palette.primaryInk} />
        ) : (
          <ChevronRight size={18} color={palette.textMuted} />
        )}
      </Touchable>
      {directory ? (
        <Touchable
          style={styles.reset}
          onPress={reset}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="恢复默认下载位置"
        >
          <Text style={[styles.resetText, { color: palette.primaryInk }]}>恢复默认</Text>
        </Touchable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.s,
    marginBottom: spacing.s,
    overflow: "hidden",
  },
  main: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  title: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  value: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    fontSize: typography.caption,
  },
  reset: {
    height: 40,
    alignSelf: "flex-end",
    justifyContent: "center",
  },
  resetText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
});
