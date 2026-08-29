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
          {/* 译文开关 */}
          <SettingsCard style={styles.row}>
            <Text style={[styles.rowLabel, { color: palette.text }]}>显示译文</Text>
            <Switch
              value={showTranslation}
              onValueChange={setShowTranslation}
              trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
              thumbColor={showTranslation ? palette.primaryText : palette.textMuted}
            />
          </SettingsCard>

          {/* 当前行颜色 */}
          <Section title="当前行颜色">
            <ColorPicker
              purpose="当前行歌词颜色"
              presets={ACTIVE_COLOR_PRESETS}
              value={activeColor}
              fallbackColor={palette.primary}
              palette={palette}
              onSelect={setActiveColor}
            />
          </Section>

          {/* 其他行颜色 */}
          <Section title="其他行颜色">
            <ColorPicker
              purpose="其他行歌词颜色"
              presets={INACTIVE_COLOR_PRESETS}
              value={inactiveColor}
              fallbackColor={palette.textMuted}
              palette={palette}
              onSelect={setInactiveColor}
            />
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
                    style={[
                      styles.fontChip,
                      {
                        backgroundColor: selected ? palette.primary : palette.surface,
                        borderColor: selected ? palette.primary : palette.border,
                      },
                    ]}
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
            <View style={[styles.previewBox, { backgroundColor: palette.surface }]}>
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
            style={[
              styles.colorChip,
              { borderColor: selected ? palette.primary : palette.border },
            ]}
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
  section: {
    marginBottom: spacing.l,
  },
  sectionHeader: {
    marginBottom: spacing.xs,
  },
  sectionBody: {
    gap: spacing.s,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    marginBottom: spacing.l,
  },
  rowLabel: {
    fontSize: typography.body,
    fontWeight: "500",
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  colorChip: {
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 64,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: radius.lg,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.1)",
  },
  colorLabel: {
    fontSize: typography.caption,
    fontWeight: "500",
  },
  fontGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  fontChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  fontChipText: {
    fontSize: typography.body,
    fontWeight: "500",
  },
  previewBox: {
    borderRadius: radius.md,
    padding: spacing.m,
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
