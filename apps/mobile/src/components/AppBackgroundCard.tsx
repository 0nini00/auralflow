import React, { useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { pickImageFromGallery } from "@/services/imagePickerService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

/**
 * 应用背景图选择卡片。
 *
 * 与桌面端 SettingsView 的 appBackgroundImagePath 对齐：选择后立即生效，
 * 图片直接显示在最底层，不做模糊处理或遮罩调节。
 */
export function AppBackgroundCard() {
  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const backgroundImageUri = useThemeStore((s) => s.backgroundImageUri);
  const setBackgroundImageUri = useThemeStore((s) => s.setBackgroundImageUri);

  const [picking, setPicking] = useState(false);

  const handlePick = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const uri = await pickImageFromGallery();
      if (uri) {
        await setBackgroundImageUri(uri);
      }
    } catch (error) {
      Alert.alert(
        "选择图片失败",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setPicking(false);
    }
  };

  const handleClear = async () => {
    if (!backgroundImageUri) return;
    Alert.alert("移除背景图", "确定要恢复主题默认背景吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: () => void setBackgroundImageUri(null),
      },
    ]);
  };

  return (
    <SettingsCard style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: palette.text }]}>应用背景图</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {backgroundImageUri ? "已使用自定义背景" : "使用主题默认背景"}
          </Text>
        </View>
      </View>

      <Text style={[styles.hint, { color: palette.textMuted }]}>
        图片会直接显示在整个应用最底层，不做模糊处理
      </Text>

      {backgroundImageUri ? (
        <View style={[styles.previewWrap, { borderColor: palette.border }]}>
          <Image source={{ uri: backgroundImageUri }} style={styles.preview} resizeMode="cover" />
        </View>
      ) : (
        <View style={[styles.emptyPreview, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
          <Text style={[styles.emptyText, { color: palette.textMuted }]}>未设置背景图</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: palette.primary,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
          onPress={handlePick}
          disabled={picking}
          android_ripple={{ color: palette.primaryText }}
        >
          <Text style={[styles.primaryButtonText, { color: palette.primaryText }]}>
            {picking ? "选择中…" : backgroundImageUri ? "更换图片" : "选择图片"}
          </Text>
        </Pressable>
        {backgroundImageUri ? (
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                backgroundColor: palette.dangerSurface,
                borderColor: palette.danger,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            onPress={handleClear}
            android_ripple={{ color: palette.danger }}
          >
            <Text style={[styles.secondaryButtonText, { color: palette.danger }]}>移除</Text>
          </Pressable>
        ) : null}
      </View>
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
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: typography.caption,
  },
  hint: {
    fontSize: typography.caption,
  },
  previewWrap: {
    height: 140,
    borderRadius: radius.md,
    borderWidth: 2,
    overflow: "hidden",
  },
  preview: {
    width: "100%",
    height: "100%",
  },
  emptyPreview: {
    height: 140,
    borderRadius: radius.md,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: typography.meta,
  },
  actions: {
    gap: spacing.s,
  },
  primaryButton: {
    minHeight: touch.minTarget,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: touch.minTarget,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
});
