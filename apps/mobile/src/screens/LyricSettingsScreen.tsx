import React from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
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
import { radius, spacing, typography } from "@/theme/tokens";

/**
 * 沉浸歌词设置内容（纯区块组件，由 settings/LyricsSettingsScreen 组装进设置页）：
 * 播放行为 / 颜色 / 字体 / 预览 四张卡片。
 * 颜色与字体会同步作用于悬浮歌词窗口（见 lyricOverlayAppearance 的同步）。
 */
export function LyricSettingsContent() {
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
  const coverSpin = useLyricSettingsStore((s) => s.coverSpin);
  const ambientCoverTint = useLyricSettingsStore((s) => s.ambientCoverTint);
  const showLyricProgress = useLyricSettingsStore((s) => s.showLyricProgress);

  const setShowTranslation = useLyricSettingsStore((s) => s.setShowTranslation);
  const setActiveColor = useLyricSettingsStore((s) => s.setActiveColor);
  const setInactiveColor = useLyricSettingsStore((s) => s.setInactiveColor);
  const setFontFamily = useLyricSettingsStore((s) => s.setFontFamily);
  const setCoverSpin = useLyricSettingsStore((s) => s.setCoverSpin);
  const setAmbientCoverTint = useLyricSettingsStore((s) => s.setAmbientCoverTint);
  const setShowLyricProgress = useLyricSettingsStore((s) => s.setShowLyricProgress);

  // 颜色/字体同样作用于悬浮歌词：变更即同步（悬浮窗开着会就地重刷）
  React.useEffect(() => {
    void syncLyricOverlayTextAppearance();
  }, [activeColor, inactiveColor, fontFamily]);

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
          {showTranslation ? (
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
          ) : null}
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
