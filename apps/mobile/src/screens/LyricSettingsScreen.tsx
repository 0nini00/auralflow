import React from "react";
import { Pressable, StyleSheet, Switch, Text, View, type TextStyle } from "react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { PaletteSlider } from "@/components/settings/PaletteSlider";
import {
  useLyricSettingsStore,
  FONT_OPTIONS,
  ACTIVE_COLOR_PRESETS,
  INACTIVE_COLOR_PRESETS,
} from "@/stores/lyricSettingsStore";
import {
  buildLyricTypographyStyleModel,
  type LyricAnimationIntensity,
} from "@/services/lyricSettingsModel";
import {
  getResolvedTheme,
  getThemePalette,
  useThemeStore,
  type ThemePalette,
} from "@/stores/themeStore";
import { syncLyricOverlayTextAppearance } from "@/services/lyricOverlayAppearance";
import { usePlayerStore } from "@/stores/playerStore";
import { useLyricLineIndex } from "@/hooks/useLyricLineIndex";
import { radius, spacing, typography } from "@/theme/tokens";

/**
 * 沉浸歌词设置内容（纯区块组件，由 settings/LyricsSettingsScreen 组装进设置页）：
 * 播放行为 / 颜色 / 字体 / 预览 四张卡片。
 * 颜色与字体会同步作用于悬浮歌词窗口（见 lyricOverlayAppearance 的同步）。
 */
/** 歌词动效强度档位（store 持久值 → 展示名） */
const ANIMATION_INTENSITY_OPTIONS: Array<{ label: string; value: LyricAnimationIntensity }> = [
  { label: "轻柔", value: "reduced" },
  { label: "标准", value: "normal" },
  { label: "增强", value: "enhanced" },
];

/**
 * 预览框固定几何常量。
 * 行高/行间距使用与字体无关的定值（不随 fontFamily 或 store 字号漂移），容器高度也为定值：
 * 这样切换字体/颜色/字号时只改变字形与颜色，框的位置、大小与两行的行布局保持完全稳定。
 * PREVIEW_FONT_SIZE 仅用于推导固定的行高，不用于字形本身（字形仍跟随 store 的 fontSize）。
 */
const PREVIEW_FONT_SIZE = 18; // 预览基准字号，仅用于推导固定行高
const PREVIEW_LINE_HEIGHT = Math.round(PREVIEW_FONT_SIZE * 1.45); // 26，锁死，避免字体不同导致行高漂移
const PREVIEW_LINE_GAP = spacing.s; // 12，固定两行间距，替代会随 lineGap 变化的 lineWrapStyle
const PREVIEW_BOX_HEIGHT = spacing.l * 2 + PREVIEW_LINE_HEIGHT * 2 + PREVIEW_LINE_GAP; // 104，容器定高

export function LyricSettingsContent() {
  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const fontSize = useLyricSettingsStore((s) => s.fontSize);
  const lineGap = useLyricSettingsStore((s) => s.lineGap);
  const textOpacity = useLyricSettingsStore((s) => s.textOpacity);
  const activeColor = useLyricSettingsStore((s) => s.activeColor);
  const inactiveColor = useLyricSettingsStore((s) => s.inactiveColor);
  const fontFamily = useLyricSettingsStore((s) => s.fontFamily);
  const textAlign = useLyricSettingsStore((s) => s.textAlign);
  const fontWeight = useLyricSettingsStore((s) => s.fontWeight);
  const manualOffsetMs = useLyricSettingsStore((s) => s.manualOffsetMs);
  const coverSpin = useLyricSettingsStore((s) => s.coverSpin);
  const ambientCoverTint = useLyricSettingsStore((s) => s.ambientCoverTint);
  const showLyricProgress = useLyricSettingsStore((s) => s.showLyricProgress);
  const enableAnimation = useLyricSettingsStore((s) => s.enableAnimation);
  const animationIntensity = useLyricSettingsStore((s) => s.animationIntensity);

  const showTranslation = useLyricSettingsStore((s) => s.showTranslation);
  const setShowTranslation = useLyricSettingsStore((s) => s.setShowTranslation);
  const setActiveColor = useLyricSettingsStore((s) => s.setActiveColor);
  const setInactiveColor = useLyricSettingsStore((s) => s.setInactiveColor);
  const setFontFamily = useLyricSettingsStore((s) => s.setFontFamily);
  const setCoverSpin = useLyricSettingsStore((s) => s.setCoverSpin);
  const setAmbientCoverTint = useLyricSettingsStore((s) => s.setAmbientCoverTint);
  const setShowLyricProgress = useLyricSettingsStore((s) => s.setShowLyricProgress);
  const setTextOpacity = useLyricSettingsStore((s) => s.setTextOpacity);
  const setEnableAnimation = useLyricSettingsStore((s) => s.setEnableAnimation);
  const setAnimationIntensity = useLyricSettingsStore((s) => s.setAnimationIntensity);

  // 颜色/字体同样作用于悬浮歌词：变更即同步（悬浮窗开着会就地重刷）
  React.useEffect(() => {
    void syncLyricOverlayTextAppearance();
  }, [activeColor, inactiveColor, fontFamily]);

  const previewLyrics = usePlayerStore((s) => s.lyrics);
  const previewIndex = useLyricLineIndex(previewLyrics, manualOffsetMs);

  const activeLineText =
    (previewIndex >= 0 ? previewLyrics[previewIndex]?.text : undefined) ??
    previewLyrics[0]?.text ??
    "长亭外 古道边 芳草碧连天";
  const inactiveLineText =
    (previewIndex >= 0 ? previewLyrics[previewIndex + 1]?.text : undefined) ??
    previewLyrics[1]?.text ??
    "晚风拂柳笛声残 夕阳山外山";

  const activeTypography = buildLyricTypographyStyleModel({
    active: true,
    fontSize,
    lineGap,
    fontFamily,
    activeColor,
    inactiveColor,
    textAlign,
    fontWeight,
    textOpacity,
    palette,
  });
  const inactiveTypography = buildLyricTypographyStyleModel({
    active: false,
    fontSize,
    lineGap,
    fontFamily,
    activeColor,
    inactiveColor,
    textAlign,
    fontWeight,
    textOpacity,
    palette,
  });

  return (
    <>
      <SettingsCard style={styles.groupCard}>
        <SwitchRow
          palette={palette}
          title="显示译文"
          subtitle="歌词下方展示翻译行"
          value={showTranslation}
          onValueChange={setShowTranslation}
          accessibilityLabel="显示译文"
        />
        <Hairline palette={palette} />
        <SwitchRow
          palette={palette}
          title="歌词切换动画"
          subtitle="换行时的高亮过渡动效"
          value={enableAnimation}
          onValueChange={setEnableAnimation}
          accessibilityLabel="歌词切换动画"
        />
        {enableAnimation ? (
          <>
            <Hairline palette={palette} />
            <View style={styles.stackGroup}>
              <Text style={[styles.rowSubtitle, { color: palette.textMuted }]}>动效强度</Text>
              <View style={styles.intensityRow}>
                {ANIMATION_INTENSITY_OPTIONS.map((option) => {
                  const selected = animationIntensity === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setAnimationIntensity(option.value)}
                      accessibilityRole="radio"
                      accessibilityLabel={`动效强度：${option.label}`}
                      accessibilityState={{ selected }}
                      style={({ pressed }) => [
                        styles.intensityChip,
                        {
                          backgroundColor: selected ? palette.primary : "transparent",
                          borderColor: selected ? palette.primary : palette.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.intensityChipText,
                          { color: selected ? palette.primaryText : palette.text },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        ) : null}
        <Hairline palette={palette} />
        <SwitchRow
          palette={palette}
          title="封面旋转"
          subtitle="播放页封面缓慢旋转（对齐 lx）"
          value={coverSpin}
          onValueChange={setCoverSpin}
          accessibilityLabel="封面旋转"
        />
        <Hairline palette={palette} />
        <SwitchRow
          palette={palette}
          title="氛围色背景"
          subtitle="用封面主色给播放页背景染色"
          value={ambientCoverTint}
          onValueChange={setAmbientCoverTint}
          accessibilityLabel="氛围色背景"
        />
        <Hairline palette={palette} />
        <SwitchRow
          palette={palette}
          title="封面页迷你歌词"
          subtitle="在封面下方显示单行歌词与进度"
          value={showLyricProgress}
          onValueChange={setShowLyricProgress}
          accessibilityLabel="封面页迷你歌词"
        />
      </SettingsCard>

      <SettingsCard style={styles.groupCard}>
        <ColorSwatchRow
          palette={palette}
          label="当前行"
          presets={ACTIVE_COLOR_PRESETS}
          value={activeColor}
          fallbackColor={palette.primary}
          onSelect={setActiveColor}
        />
        <Hairline palette={palette} />
        <ColorSwatchRow
          palette={palette}
          label="其他行"
          presets={INACTIVE_COLOR_PRESETS}
          value={inactiveColor}
          fallbackColor={palette.textMuted}
          onSelect={setInactiveColor}
        />
        <Hairline palette={palette} />
        <View style={styles.stackGroup}>
          <Text style={[styles.rowSubtitle, { color: palette.textMuted }]}>
            其他行与译文透明度 · {Math.round(textOpacity * 100)}%
          </Text>
          <PaletteSlider
            style={styles.fullSlider}
            min={0.1}
            max={1}
            step={0.05}
            value={textOpacity}
            palette={palette}
            onChange={setTextOpacity}
          />
        </View>
      </SettingsCard>

      <SettingsCard style={styles.groupCard}>
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
                    backgroundColor: selected ? palette.primary : "transparent",
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
      </SettingsCard>

      <SettingsCard style={styles.groupCard}>
        <View style={[styles.previewBox, { backgroundColor: palette.surfaceMuted }]}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.previewLine, activeTypography.lineTextStyle as TextStyle]}
          >
            {activeLineText}
          </Text>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.previewLine, inactiveTypography.lineTextStyle as TextStyle]}
          >
            {inactiveLineText}
          </Text>
        </View>
      </SettingsCard>
    </>
  );
}

/* ---------------- 子组件 ---------------- */

function Hairline({ palette }: { palette: ThemePalette }) {
  return <View style={[styles.hairline, { backgroundColor: palette.border }]} />;
}

interface SwitchRowProps {
  palette: ThemePalette;
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
}

function SwitchRow({ palette, title, subtitle, value, onValueChange, accessibilityLabel }: SwitchRowProps) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.copy}>
        <Text style={[styles.rowTitle, { color: palette.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: palette.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={accessibilityLabel}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
        thumbColor={value ? palette.primaryText : palette.textMuted}
      />
    </View>
  );
}

interface ColorSwatchRowProps {
  palette: ThemePalette;
  label: string;
  presets: Array<{ label: string; value: string }>;
  value: string;
  fallbackColor: string;
  onSelect: (v: string) => void;
}

/** 紧凑圆形色板：一行圆点，选中 = 主色描边圈；行标题跟随显示当前选中的预设名 */
function ColorSwatchRow({ palette, label, presets, value, fallbackColor, onSelect }: ColorSwatchRowProps) {
  const selectedPreset = presets.find((preset) => preset.value === value);
  return (
    <View style={styles.stackGroup}>
      <Text style={[styles.rowSubtitle, { color: palette.textMuted }]}>
        {label} · {selectedPreset ? selectedPreset.label : "自定义"}
      </Text>
      <View style={styles.swatchRow}>
        {presets.map((preset) => {
          const selected = value === preset.value;
          const swatchColor = preset.value || fallbackColor;
          return (
            <Pressable
              key={preset.label}
              onPress={() => onSelect(preset.value)}
              accessibilityRole="radio"
              accessibilityLabel={`${label}歌词颜色：${preset.label}${preset.value ? `，颜色 ${preset.value}` : "，跟随主题"}`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.swatchRing,
                {
                  borderColor: selected ? palette.primary : "transparent",
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.swatchCircle,
                  {
                    backgroundColor: swatchColor,
                    borderColor: palette.border,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ---------------- 样式 ---------------- */

const styles = StyleSheet.create({
  groupCard: {
    gap: spacing.xs,
    padding: spacing.s,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingVertical: spacing.xxs,
    minHeight: 52,
  },
  stackGroup: {
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  fullSlider: {
    width: "100%",
  },
  intensityRow: {
    flexDirection: "row",
    gap: spacing.s,
  },
  intensityChip: {
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 2,
    minHeight: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  intensityChipText: {
    fontSize: typography.caption,
    fontWeight: "600",
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  rowTitle: { fontSize: typography.body, fontWeight: "600" },
  rowSubtitle: { fontSize: typography.caption },
  swatchRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.s,
  },
  swatchRing: {
    padding: 2.5,
    borderWidth: 2,
    borderRadius: 999,
  },
  swatchCircle: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
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
    minHeight: 44,
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
    justifyContent: "center",
    height: PREVIEW_BOX_HEIGHT,
    gap: PREVIEW_LINE_GAP,
    overflow: "hidden",
  },
  previewLine: {
    width: "100%",
    textAlign: "center",
    lineHeight: PREVIEW_LINE_HEIGHT,
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
