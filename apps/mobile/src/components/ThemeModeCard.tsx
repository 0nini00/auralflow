import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { DEFAULT_ACCENT_COLOR, parseAccentColorInput } from "@/services/themePaletteModel";
import { getResolvedTheme, getThemePalette, type ThemeMode, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

const ACCENT_OPTIONS = [
  { label: "默认", value: DEFAULT_ACCENT_COLOR },
  { label: "蓝色", value: "#3366ff" },
  { label: "紫色", value: "#8b5cf6" },
  { label: "橙色", value: "#f97316" },
  { label: "粉色", value: "#ec4899" },
] as const;

function getThemeModeLabel(mode: ThemeMode, systemTheme: "light" | "dark") {
  if (mode === "system") {
    return `跟随系统（${systemTheme === "light" ? "浅色" : "深色"}）`;
  }

  return mode === "light" ? "浅色" : "深色";
}

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
    <SettingsCard style={styles.themeCard}>
      <View style={styles.themeHeader}>
        <Text style={[styles.themeTitle, { color: palette.text }]}>主题</Text>
        <Text style={[styles.themeSubtitle, { color: palette.textMuted }]}>
          当前：{getThemeModeLabel(themeMode, systemTheme)}
        </Text>
      </View>
      <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>明暗模式</Text>
      <View style={styles.themeOptions}>
        {THEME_OPTIONS.map((option) => {
          const active = option.value === themeMode;
          return (
            <Pressable
              key={option.value}
              style={({ pressed }) => [
                styles.themeOption,
                {
                  backgroundColor: active ? palette.primary : palette.surfaceMuted,
                  borderColor: active ? palette.primary : palette.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              onPress={() => setThemeMode(option.value)}
              android_ripple={{ color: palette.primary }}
            >
              <Text
                style={[
                  styles.themeOptionText,
                  { color: active ? palette.primaryText : palette.textMuted },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>主题色</Text>
      <View style={styles.customAccentRow}>
        <View
          style={[
            styles.customAccentSwatch,
            { backgroundColor: accentColor, borderColor: palette.border },
          ]}
        />
        <TextInput
          style={[
            styles.customAccentInput,
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
        />
      </View>
      {!isAccentColorInputValid ? (
        <Text style={[styles.accentInputError, { color: palette.danger }]}>请输入 6 位 Hex 颜色</Text>
      ) : null}
      <View style={styles.accentOptions}>
        {ACCENT_OPTIONS.map((option) => {
          const active = option.value === accentColor;
          return (
            <Pressable
              key={option.value}
              style={({ pressed }) => [
                styles.accentOption,
                {
                  borderColor: active ? palette.primary : palette.border,
                  backgroundColor: active ? palette.surfaceStrong : palette.surfaceMuted,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              onPress={() => void setAccentColor(option.value)}
              android_ripple={{ color: palette.primary }}
            >
              <View style={[styles.accentSwatch, { backgroundColor: option.value }]} />
              <Text style={[styles.accentLabel, { color: active ? palette.primary : palette.textMuted }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.resetAccentButton,
          {
            borderColor: palette.border,
            backgroundColor: palette.surfaceMuted,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
        onPress={() => void resetAccentColor()}
        android_ripple={{ color: palette.textMuted }}
      >
        <Text style={[styles.resetAccentText, { color: palette.textMuted }]}>重置为默认主题色</Text>
      </Pressable>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  themeCard: {
    gap: spacing.s,
  },
  // 卡片自带 gap: spacing.s，子元素不再叠加 marginBottom，间距节奏统一
  themeHeader: {
    gap: spacing.xxs,
  },
  themeTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  themeSubtitle: {
    fontSize: 13,
  },
  sectionLabel: {
    fontSize: typography.caption,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  themeOptions: {
    flexDirection: "row",
    gap: spacing.s,
  },
  themeOption: {
    flex: 1,
    minHeight: touch.minTarget,
    borderWidth: 2,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  themeOptionText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
  accentOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s,
  },
  customAccentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  customAccentSwatch: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 2,
  },
  customAccentInput: {
    flex: 1,
    minHeight: touch.minTarget,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.m,
    fontSize: typography.body,
    fontWeight: "600",
  },
  accentInputError: {
    fontSize: typography.caption,
    fontWeight: "500",
  },
  accentOption: {
    minWidth: 80,
    minHeight: touch.minTarget,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.s,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  accentSwatch: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.1)",
  },
  accentLabel: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  resetAccentButton: {
    minHeight: touch.minTarget,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.m,
    alignItems: "center",
    justifyContent: "center",
  },
  resetAccentText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
});
