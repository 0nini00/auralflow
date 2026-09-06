import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Check, Monitor, Moon, Sun } from "lucide-react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { DEFAULT_ACCENT_COLOR, parseAccentColorInput, withAlpha } from "@/services/themePaletteModel";
import { getResolvedTheme, getThemePalette, type ThemeMode, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

const ACCENT_OPTIONS = [
  { label: "默认", value: DEFAULT_ACCENT_COLOR },
  { label: "蓝色", value: "#3366ff" },
  { label: "紫色", value: "#8b5cf6" },
  { label: "橙色", value: "#f97316" },
  { label: "粉色", value: "#ec4899" },
] as const;

/**
 * 外观设置：明暗模式 + 主题色两张聚焦卡片。
 * 明暗模式 = 带图标的三选一块；主题色 = 圆形色板单行 + 精简 Hex 自定义输入。
 */
export function ThemeModeCard() {
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const setAccentColor = useThemeStore((state) => state.setAccentColor);
  const resetAccentColor = useThemeStore((state) => state.resetAccentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const [accentColorInput, setAccentColorInput] = useState(accentColor.toUpperCase());
  const parsedAccentColorInput = parseAccentColorInput(accentColorInput);
  const isAccentColorInputValid = parsedAccentColorInput !== null;
  const isCustomAccent = accentColor !== DEFAULT_ACCENT_COLOR;

  useEffect(() => {
    setAccentColorInput(accentColor.toUpperCase());
  }, [accentColor]);

  const handleAccentColorInputChange = (nextValue: string) => {
    setAccentColorInput(nextValue);
    const nextAccentColor = parseAccentColorInput(nextValue);
    if (!nextAccentColor) return;
    void setAccentColor(nextAccentColor);
  };

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
                    backgroundColor: active ? withAlpha(palette.primary, 0.12) : palette.surfaceMuted,
                    borderColor: active ? palette.primary : palette.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                onPress={() => setThemeMode(option.value)}
                android_ripple={{ color: withAlpha(palette.primary, 0.2) }}
              >
                <Icon size={20} color={active ? palette.primary : palette.textMuted} strokeWidth={2} />
                <Text
                  style={[
                    styles.modeTileText,
                    { color: active ? palette.primary : palette.textMuted },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {themeMode === "system" ? (
          <Text style={[styles.modeCaption, { color: palette.textSubtle }]}>
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
              <Text style={[styles.resetLink, { color: palette.primary }]}>重置</Text>
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
                  { borderColor: active ? palette.primary : "transparent", opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={() => void setAccentColor(option.value)}
              >
                <View style={[styles.swatchCircle, { backgroundColor: option.value }]}>
                  {active ? <Check size={16} color="#ffffff" strokeWidth={3} /> : null}
                </View>
              </Pressable>
            );
          })}
          <View style={[styles.swatchRing, { borderColor: "transparent" }]}>
            <View
              style={[
                styles.swatchCircle,
                styles.swatchCustom,
                { backgroundColor: accentColor, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.swatchCustomText, { color: palette.textMuted }]}>自定</Text>
            </View>
          </View>
        </View>

        <View style={styles.customRow}>
          <TextInput
            style={[
              styles.customInput,
              {
                color: palette.text,
                backgroundColor: palette.surfaceMuted,
                borderColor: isAccentColorInputValid ? palette.border : palette.danger,
              },
            ]}
            value={accentColorInput}
            onChangeText={handleAccentColorInputChange}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="#3BD877"
            placeholderTextColor={palette.textSubtle}
            accessibilityLabel="自定义主题色 Hex 值"
          />
          <View style={[styles.customPreview, { backgroundColor: accentColor, borderColor: palette.border }]} />
        </View>
        {!isAccentColorInputValid ? (
          <Text style={[styles.inputError, { color: palette.danger }]}>请输入 6 位 Hex 颜色</Text>
        ) : null}
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
    gap: spacing.m,
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
  swatchCustom: {
    // 自定义入口：底色实时跟随当前 accentColor（JSX 中覆盖）
  },
  swatchCustomText: {
    fontSize: 10,
    fontWeight: "700",
  },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  customInput: {
    flex: 1,
    minHeight: touch.minTarget,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.m,
    fontSize: typography.body,
    fontWeight: "600",
  },
  customPreview: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 2,
  },
  inputError: {
    fontSize: typography.caption,
    fontWeight: "500",
    marginTop: -spacing.xs,
  },
});
