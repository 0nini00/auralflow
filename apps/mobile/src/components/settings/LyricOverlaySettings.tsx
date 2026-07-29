import React, { useEffect } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  canDrawOverlays,
  hideLyricOverlay,
  isLyricOverlaySupported,
  requestOverlayPermission,
  setLyricOverlayLocked,
  showLyricOverlay,
} from "@/services/lyricOverlayService";
import { useLyricOverlayStore } from "@/stores/lyricOverlayStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

export function LyricOverlaySettings() {
  const visible = useLyricOverlayStore((state) => state.visible);
  const locked = useLyricOverlayStore((state) => state.locked);
  const loaded = useLyricOverlayStore((state) => state.loaded);
  const load = useLyricOverlayStore((state) => state.loadFromStorage);
  const setVisible = useLyricOverlayStore((state) => state.setVisible);
  const setLocked = useLyricOverlayStore((state) => state.setLocked);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  const toggleVisible = async () => {
    try {
      if (visible) {
        await hideLyricOverlay();
        await setVisible(false);
        return;
      }
      if (!isLyricOverlaySupported()) throw new Error("当前设备不支持原生悬浮歌词");
      let granted = await canDrawOverlays();
      if (!granted) granted = await requestOverlayPermission();
      if (!granted) throw new Error("请在系统设置中允许应用显示在其他应用上层");
      if (!await showLyricOverlay()) throw new Error("原生悬浮歌词窗口未能打开");
      await setVisible(true);
    } catch (error) {
      Alert.alert("悬浮歌词操作失败", error instanceof Error ? error.message : String(error));
    }
  };

  const toggleLocked = async () => {
    try {
      const next = !locked;
      await setLyricOverlayLocked(next);
      await setLocked(next);
    } catch (error) {
      Alert.alert("悬浮歌词锁定失败", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: palette.text }]}>悬浮歌词</Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>在其他应用上层显示当前歌词</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={visible ? "关闭悬浮歌词" : "打开悬浮歌词"}
        accessibilityState={{ selected: visible }}
        onPress={() => void toggleVisible()}
        style={[styles.button, { backgroundColor: visible ? palette.primary : palette.surfaceMuted }]}
      >
        <Text style={[styles.buttonText, { color: visible ? palette.primaryText : palette.textMuted }]}>
          {visible ? "已显示" : "未显示"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={locked ? "解锁悬浮歌词" : "锁定悬浮歌词"}
        accessibilityState={{ selected: locked }}
        onPress={() => void toggleLocked()}
        style={[styles.button, { backgroundColor: locked ? palette.primary : palette.surfaceMuted }]}
      >
        <Text style={[styles.buttonText, { color: locked ? palette.primaryText : palette.textMuted }]}>
          {locked ? "已锁定" : "可拖动"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
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
  button: {
    minHeight: touch.minTarget,
    minWidth: 68,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: typography.caption, fontWeight: "700" },
});
