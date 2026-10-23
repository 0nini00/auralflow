import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Check, Monitor, Moon, Sun } from "lucide-react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { ThemeColorPicker } from "@/components/settings/ThemeColorPicker";
import { DEFAULT_ACCENT_COLOR, withAlpha } from "@/services/themePaletteModel";
import { getResolvedTheme, getThemePalette, type ThemeMode, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

/**
 * 预设主题色：第一项是默认深绿（与按钮/文字行动色同档）。
 * 其余颜色都选在「白字可读」的深度，保证 actionFill + onActionFill 不变。
 */
const ACCENT_OPTIONS = [
  { label: "默认绿", value: "#0d7a42" },
  { label: "松针", value: "#146b52" },
  { label: "湖蓝", value: "#1d6fa5" },
  { label: "靛青", value: "#3b4fa8" },
  { label: "暮紫", value: "#6b4ba8" },
  { label: "赭橙", value: "#a9531a" },
  { label: "莓红", value: "#a8324f" },
  { label: "岩灰", value: "#4a5450" },
] as const;

/**
 * 外观设置：明暗模式 + 主题色两张聚焦卡片。
 * 主题色 = 8 个预设圆形色板 + 可展开的 HSV 调色盘（含 Hex 输入）。
 */
export function ThemeModeCard() {
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const setAccentColor = useThemeStore((state) => state.setAccentColor);
  const resetAccentColor = useThemeStore((state) => state.resetAccentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const isCustomAccent = accentColor !== DEFAULT_ACCENT_COLOR;
  const activePreset = ACCENT_OPTIONS.find((option) => option.value === accentColor);

  return (
    <>
      <SettingsCard style={styles.card}>
        <Text style={[styles.cardTitle, { color: palette.text }]}>明暗模式</Text>
        <View style={styles.modeRow}>
          {THEME_OPTIONS.map((option) => {
            const active = option.value === themeMode;
            const Icon = option.icon;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={`明暗模式：${option.label}`}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.modeTile,
                  {
                    backgroundColor: active ? withAlpha(palette.primaryInk, 0.12) : palette.surfaceMuted,
                    borderColor: active ? palette.primaryInk : palette.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                onPress={() => setThemeMode(option.value)}
                android_ripple={{ color: withAlpha(palette.primaryInk, 0.2) }}
              >
                <Icon size={20} color={active ? palette.primaryInk : palette.textMuted} strokeWidth={2} />
                <Text
                  style={[
                    styles.modeTileText,
                    { color: active ? palette.primaryInk : palette.textMuted },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {themeMode === "system" ? (
          <Text style={[styles.modeCaption, { color: palette.textMuted }]}>
            当前跟随系统 · 实际为{systemTheme === "light" ? "浅色" : "深色"}
          </Text>
        ) : null}
      </SettingsCard>

      <SettingsCard style={styles.card}>
        <View style={styles.titleRow}>
          <Text style={[styles.cardTitle, { color: palette.text }]}>主题色</Text>
          {isCustomAccent ? (
            <Pressable
              onPress={() => void resetAccentColor()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="重置为默认主题色"
            >
              <Text style={[styles.resetLink, { color: palette.primaryInk }]}>重置</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.swatchRow}>
          {ACCENT_OPTIONS.map((option) => {
            const active = option.value === accentColor;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={`主题色：${option.label}`}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.swatchRing,
                  { borderColor: active ? palette.primaryInk : "transparent", opacity: pressed ? 0.72 : 1 },
                ]}
                onPress={() => void setAccentColor(option.value)}
              >
                <View style={[styles.swatchCircle, { backgroundColor: option.value }]}>
                  {active ? <Check size={16} color="#ffffff" strokeWidth={3} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.currentLabel, { color: palette.textMuted }]}>
          {activePreset ? `当前：${activePreset.label}` : "当前：自定义颜色"}
        </Text>

        <ThemeColorPicker
          value={accentColor}
          onChange={(color) => void setAccentColor(color)}
        />
      </SettingsCard>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.m,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  resetLink: {
    fontSize: typography.caption,
    fontWeight: "700",
    minHeight: touch.minTarget / 2,
    textAlignVertical: "center",
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.s,
  },
  modeTile: {
    flex: 1,
    minHeight: touch.minTarget + 8,
    borderWidth: 2,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  modeTileText: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  modeCaption: {
    fontSize: typography.caption,
    marginTop: -spacing.xxs,
  },
  swatchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    flexWrap: "wrap",
  },
  swatchRing: {
    padding: 3,
    borderWidth: 2,
    borderRadius: 999,
  },
  swatchCircle: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
  },
  currentLabel: {
    marginTop: -spacing.xs,
    fontSize: typography.micro,
  },
});
