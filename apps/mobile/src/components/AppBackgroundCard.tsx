import React, { useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { pickImageFromGallery } from "@/services/imagePickerService";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

/**
 * 应用背景图选择卡片。
 *
 * 与桌面端 SettingsView 的 appBackgroundImagePath 对齐：选择后立即生效，
 * 支持切换、清除、以及调整覆盖遮罩强度（对应桌面的沉浸背景明度）。
 */
export function AppBackgroundCard() {
  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const backgroundImageUri = useThemeStore((s) => s.backgroundImageUri);
  const backgroundOpacity = useThemeStore((s) => s.backgroundOpacity);
  const setBackgroundImageUri = useThemeStore((s) => s.setBackgroundImageUri);
  const setBackgroundOpacity = useThemeStore((s) => s.setBackgroundOpacity);

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

  const opacityOptions: Array<{ label: string; value: number }> = [
    { label: "透明", value: 0.2 },
    { label: "淡", value: 0.4 },
    { label: "标准", value: 0.55 },
    { label: "浓", value: 0.75 },
    { label: "遮罩", value: 0.9 },
  ];

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: palette.text }]}>应用背景图</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {backgroundImageUri ? "已使用自定义背景" : "使用主题默认背景"}
          </Text>
        </View>
        {backgroundImageUri ? (
          <Pressable
            style={[styles.smallButton, { backgroundColor: palette.dangerSurface }]}
            onPress={handleClear}
          >
            <Text style={[styles.smallButtonText, { color: palette.danger }]}>移除</Text>
          </Pressable>
        ) : null}
      </View>

      {backgroundImageUri ? (
        <View style={[styles.previewWrap, { borderColor: palette.border }]}>
          <Image source={{ uri: backgroundImageUri }} style={styles.preview} resizeMode="cover" />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: palette.background, opacity: backgroundOpacity },
            ]}
          />
          <View style={styles.previewOverlay}>
            <Text style={[styles.previewText, { color: palette.text }]}>预览遮罩效果</Text>
          </View>
        </View>
      ) : (
        <View style={[styles.emptyPreview, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
          <Text style={[styles.emptyText, { color: palette.textMuted }]}>未设置</Text>
        </View>
      )}

      <Pressable
        style={[styles.primaryButton, { backgroundColor: palette.primary }]}
        onPress={handlePick}
        disabled={picking}
      >
        <Text style={[styles.primaryButtonText, { color: palette.primaryText }]}>
          {picking ? "选择中..." : backgroundImageUri ? "更换图片" : "选择图片"}
        </Text>
      </Pressable>

      {backgroundImageUri ? (
        <View style={styles.opacitySection}>
          <Text style={[styles.opacityLabel, { color: palette.textMuted }]}>遮罩强度</Text>
          <View style={styles.opacityGrid}>
            {opacityOptions.map((option) => {
              const active = Math.abs(backgroundOpacity - option.value) < 0.05;
              return (
                <Pressable
                  key={option.label}
                  style={[
                    styles.opacityOption,
                    { borderColor: palette.border, backgroundColor: palette.surfaceMuted },
                    active && { borderColor: palette.primary, backgroundColor: palette.primary },
                  ]}
                  onPress={() => void setBackgroundOpacity(option.value)}
                >
                  <Text
                    style={[
                      styles.opacityText,
                      { color: active ? palette.primaryText : palette.text },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 12,
    marginTop: 3,
  },
  smallButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  smallButtonText: {
    fontSize: 13,
    fontWeight: "700",
  },
  previewWrap: {
    height: 140,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  preview: {
    width: "100%",
    height: "100%",
  },
  previewOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  previewText: {
    fontSize: 12,
    fontWeight: "600",
    opacity: 0.9,
  },
  emptyPreview: {
    height: 90,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 13,
  },
  primaryButton: {
    minHeight: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
  },
  opacitySection: {
    gap: 8,
  },
  opacityLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  opacityGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  opacityOption: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  opacityText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
