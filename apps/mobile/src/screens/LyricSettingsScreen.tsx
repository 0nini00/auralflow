import React from "react";
import { View, Text, StyleSheet, Pressable, Switch, Modal, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";

import { IconButton } from "@/components/IconButton";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SectionHeader } from "@/components/SectionHeader";
import {
  useLyricSettingsStore,
  FONT_OPTIONS,
  ACTIVE_COLOR_PRESETS,
  INACTIVE_COLOR_PRESETS,
} from "@/stores/lyricSettingsStore";
import {
  getResolvedTheme,
  getThemePalette,
  useThemeStore,
  type ThemePalette,
} from "@/stores/themeStore";
import { syncLyricOverlayTextAppearance } from "@/services/lyricOverlayAppearance";
import { radius, spacing, touch, typography } from "@/theme/tokens";

export interface LyricSettingsScreenProps {
  visible: boolean;
  onBack: () => void;
}

export interface LyricSettingsContentProps {
  onBack: () => void;
  showNavigation?: boolean;
}

export function LyricSettingsScreen({ visible, onBack }: LyricSettingsScreenProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onBack}
      statusBarTranslucent
    >
      <LyricSettingsContent onBack={onBack} />
    </Modal>
  );
}

/**
 * 歌词样式设置：仅保留 译文 / 当前行颜色 / 其他行颜色 / 字体。
 * 字号、行间距、其他行透明度、偏移、对齐、字重、动效等一律固定为
 * lyricSettingsStore 里的默认值（不再暴露 UI）；颜色与字体会同步作用于
 * 悬浮歌词窗口（见 LyricOverlaySettings 的颜色/字体同步）。
 */
export function LyricSettingsContent({ onBack, showNavigation = true }: LyricSettingsContentProps) {
  const insets = useSafeAreaInsets();

  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const fontSize = useLyricSettingsStore((s) => s.fontSize);
  const lineGap = useLyricSettingsStore((s) => s.lineGap);
  const textOpacity = useLyricSettingsStore((s) => s.textOpacity);
  const showTranslation = useLyricSettingsStore((s) => s.showTranslation);
  const activeColor = useLyricSettingsStore((s) => s.activeColor);
  const inactiveColor = useLyricSettingsStore((s) => s.inactiveColor);
  const fontFamily = useLyricSettingsStore((s) => s.fontFamily);

  const setShowTranslation = useLyricSettingsStore((s) => s.setShowTranslation);
  const setActiveColor = useLyricSettingsStore((s) => s.setActiveColor);
  const setInactiveColor = useLyricSettingsStore((s) => s.setInactiveColor);
  const setFontFamily = useLyricSettingsStore((s) => s.setFontFamily);
  const resetSettings = useLyricSettingsStore((s) => s.resetSettings);

  // 颜色/字体同样作用于悬浮歌词：变更即同步（悬浮窗开着会就地重刷）
  React.useEffect(() => {
    void syncLyricOverlayTextAppearance();
  }, [activeColor, inactiveColor, fontFamily]);

  const confirmResetSettings = () => {
    Alert.alert("恢复默认样式", "确定恢复歌词默认样式吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "恢复",
        style: "destructive",
        onPress: () => {
          void resetSettings();
          Alert.alert("已恢复", "歌词样式已恢复为默认设置");
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.background, paddingTop: showNavigation ? insets.top : 0 }]}>
      <ScreenScaffold style={styles.scaffold}>
        {showNavigation ? (
          <View style={[styles.topBar, { borderBottomColor: palette.border }]}>
            <IconButton
              onPress={onBack}
              tone="strong"
              accessibilityLabel="关闭歌词设置"
              render={({ size, color }) => <ChevronLeft size={size} strokeWidth={2} color={color} />}
            />
            <Text style={[styles.title, { color: palette.text }]}>歌词样式</Text>
            <Pressable
              onPress={confirmResetSettings}
              style={styles.resetButton}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="恢复默认歌词样式"
            >
              <Text style={[styles.resetButtonText, { color: palette.primary }]}>恢复默认样式</Text>
            </Pressable>
          </View>
        ) : null}

        <ScreenScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        >
          <View style={styles.sections}>
            {/* 基本设置 */}
            <Section title="基本设置">
              <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: palette.text }]}>显示译文</Text>
                <Switch
                  value={showTranslation}
                  onValueChange={setShowTranslation}
                  trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
                  thumbColor={showTranslation ? palette.primaryText : palette.textMuted}
                />
              </View>
            </Section>

            {/* 颜色 */}
            <Section title="颜色">
              <View style={styles.colorSection}>
                <Text style={[styles.colorSectionLabel, { color: palette.textMuted }]}>当前行</Text>
                <ColorPicker
                  purpose="当前行歌词颜色"
                  presets={ACTIVE_COLOR_PRESETS}
                  value={activeColor}
                  fallbackColor={palette.primary}
                  palette={palette}
                  onSelect={setActiveColor}
                />
              </View>
              <View style={styles.colorSection}>
                <Text style={[styles.colorSectionLabel, { color: palette.textMuted }]}>其他行</Text>
                <ColorPicker
                  purpose="其他行歌词颜色"
                  presets={INACTIVE_COLOR_PRESETS}
                  value={inactiveColor}
                  fallbackColor={palette.textMuted}
                  palette={palette}
                  onSelect={setInactiveColor}
                />
              </View>
            </Section>

            {/* 字体 */}
            <Section title="字体">
              <View style={styles.fontGrid}>
                {FONT_OPTIONS.map((opt) => {
                  const selected = fontFamily === opt.value;
                  return (
                    <Pressable
                      key={opt.value || "system"}
                      onPress={() => setFontFamily(opt.value)}
                      accessibilityRole="radio"
                      accessibilityLabel={`字体：${opt.label}`}
                      accessibilityState={{ selected }}
                      style={({ pressed }) => [
                        styles.fontChip,
                        {
                          backgroundColor: selected ? palette.primary : palette.surface,
                          borderColor: selected ? palette.primary : palette.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                      android_ripple={{ color: palette.primary }}
                    >
                      <Text
                        style={[
                          styles.fontChipText,
                          {
                            color: selected ? palette.primaryText : palette.text,
                            fontFamily: opt.value || undefined,
                          },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            {/* 预览 */}
            <Section title="预览">
              <View style={[styles.previewBox, { backgroundColor: palette.surfaceMuted }]}>
                <Text
                  style={[
                    styles.previewActive,
                    {
                      color: activeColor || palette.primary,
                      fontSize,
                      fontFamily: fontFamily || undefined,
                      marginBottom: lineGap,
                    },
                  ]}
                >
                  这是当前正在播放的歌词行
                </Text>
                <Text
                  style={[
                    styles.previewInactive,
                    {
                      color: inactiveColor || palette.textMuted,
                      fontSize,
                      fontFamily: fontFamily || undefined,
                      opacity: textOpacity,
                    },
                  ]}
                >
                  这是其他未播放的歌词行
                </Text>
                {showTranslation && (
                  <Text
                    style={[
                      styles.previewTranslation,
                      {
                        color: palette.textSubtle,
                        marginTop: lineGap / 2,
                        opacity: textOpacity,
                      },
                    ]}
                  >
                    This is a translation line
                  </Text>
                )}
              </View>
            </Section>
          </View>
        </ScreenScrollView>
      </ScreenScaffold>
    </View>
  );
}

/* ---------------- 子组件 ---------------- */

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} style={styles.sectionHeader} />
      <SettingsCard style={styles.sectionBody}>
        {children}
      </SettingsCard>
    </View>
  );
}

interface ColorPickerProps {
  purpose: string;
  presets: Array<{ label: string; value: string }>;
  value: string;
  fallbackColor: string;
  palette: ThemePalette;
  onSelect: (v: string) => void;
}

function ColorPicker({ purpose, presets, value, fallbackColor, palette, onSelect }: ColorPickerProps) {
  return (
    <View style={styles.colorRow}>
      {presets.map((p) => {
        const selected = value === p.value;
        const swatchColor = p.value || fallbackColor;
        return (
          <Pressable
            key={p.label}
            onPress={() => onSelect(p.value)}
            accessibilityRole="radio"
            accessibilityLabel={`${purpose}：${p.label}${p.value ? `，颜色 ${p.value}` : "，跟随主题"}`}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.colorChip,
              {
                borderColor: selected ? palette.primary : palette.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            android_ripple={{ color: palette.primary }}
          >
            <View style={[styles.colorSwatch, { backgroundColor: swatchColor }]} />
            <Text
              style={[
                styles.colorLabel,
                { color: selected ? palette.primary : palette.textMuted },
              ]}
              numberOfLines={1}
            >
              {p.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------------- 样式 ---------------- */

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scaffold: {
    borderRadius: 0,
    borderWidth: 0,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    flex: 1,
    textAlign: "left",
    fontSize: typography.title,
    fontWeight: "700",
  },
  resetButton: {
    minWidth: 96,
    minHeight: touch.minTarget,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  resetButtonText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
  content: {
    paddingHorizontal: spacing.m,
    paddingTop: spacing.m,
  },
  sections: {
    gap: spacing.l,
  },
  section: {
    gap: spacing.xs,
  },
  sectionHeader: {
    marginBottom: 0,
  },
  sectionBody: {
    gap: spacing.m,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  settingLabel: {
    fontSize: typography.body,
    fontWeight: "500",
  },
  colorSection: {
    gap: spacing.xs,
  },
  colorSectionLabel: {
    fontSize: typography.caption,
    fontWeight: "600",
    paddingLeft: spacing.xxs,
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s,
  },
  colorChip: {
    alignItems: "center",
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.s,
    minWidth: 72,
    minHeight: touch.minTarget,
    justifyContent: "center",
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 999,
    marginBottom: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.1)",
  },
  colorLabel: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  fontGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s,
  },
  fontChip: {
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderRadius: radius.md,
    borderWidth: 2,
    minWidth: 88,
    minHeight: touch.minTarget,
    justifyContent: "center",
    alignItems: "center",
  },
  fontChipText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  previewBox: {
    borderRadius: radius.md,
    padding: spacing.l,
    alignItems: "center",
  },
  previewActive: {
    fontWeight: "700",
    textAlign: "center",
    width: "100%",
  },
  previewInactive: {
    fontWeight: "500",
    textAlign: "center",
    width: "100%",
  },
  previewTranslation: {
    fontSize: typography.caption,
    textAlign: "center",
    width: "100%",
  },
});
