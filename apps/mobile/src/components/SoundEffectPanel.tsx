import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { EQ_FREQS, EQ_PRESETS, useSoundEffectStore } from "@/stores/soundEffectStore";
import { getResolvedTheme, getThemePalette, useThemeStore, type ThemePalette } from "@/stores/themeStore";
import { isSoundEffectSupported } from "@/services/soundEffectService";
import { radius, spacing, touch, typography } from "@/theme/tokens";

const GAIN_STEPS = [-12, -8, -4, -2, 0, 2, 4, 8, 12];
const PAN_STEPS = [-1, -0.5, 0, 0.5, 1];
const REVERB_STEPS = [0, 0.25, 0.5, 0.75, 1];

export function SoundEffectPanel() {
  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const enabled = useSoundEffectStore((s) => s.enabled);
  const gains = useSoundEffectStore((s) => s.gains);
  const pan = useSoundEffectStore((s) => s.pan);
  const reverbMix = useSoundEffectStore((s) => s.reverbMix);
  const presetId = useSoundEffectStore((s) => s.presetId);
  const setEnabled = useSoundEffectStore((s) => s.setEnabled);
  const setGain = useSoundEffectStore((s) => s.setGain);
  const setPan = useSoundEffectStore((s) => s.setPan);
  const setReverbMix = useSoundEffectStore((s) => s.setReverbMix);
  const applyPreset = useSoundEffectStore((s) => s.applyPreset);
  const reset = useSoundEffectStore((s) => s.reset);

  if (!isSoundEffectSupported()) {
    return (
      <SettingsCard style={styles.card}>
        <Text style={[styles.cardTitle, { color: palette.text }]}>音效</Text>
        <Text style={[styles.hint, { color: palette.textMuted }]}>当前设备不支持系统级音效。</Text>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={[styles.cardTitle, { color: palette.text }]}>音效</Text>
          <Text style={[styles.hint, { color: palette.textMuted }]}>
            5 段均衡、声像、混响，与桌面版一致
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => void reset()}
            style={[styles.resetBtn, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}
          >
            <Text style={[styles.resetText, { color: palette.textMuted }]}>恢复默认</Text>
          </Pressable>
          <Pressable
            onPress={() => void setEnabled(!enabled)}
            style={[
              styles.enableBtn,
              { backgroundColor: enabled ? palette.primary : palette.surfaceMuted, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.enableText, { color: enabled ? palette.primaryText : palette.textMuted }]}>
              {enabled ? "已启用" : "已关闭"}
            </Text>
          </Pressable>
        </View>
      </View>

      <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>预设</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
        {EQ_PRESETS.map((preset) => {
          const active = presetId === preset.id;
          return (
            <Pressable
              key={preset.id}
              onPress={() => void applyPreset(preset.id)}
              style={[
                styles.presetChip,
                { borderColor: palette.border, backgroundColor: palette.surfaceMuted },
                active && { backgroundColor: palette.primary, borderColor: palette.primary },
              ]}
              disabled={!enabled}
            >
              <Text style={[styles.presetText, { color: active ? palette.primaryText : palette.text }]}>
                {preset.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>均衡器</Text>
      <View style={styles.eqGroup}>
        {EQ_FREQS.map((freq, index) => (
          <EqBand
            key={freq}
            freq={freq}
            gain={gains[index] ?? 0}
            palette={palette}
            disabled={!enabled}
            onChange={(value) => void setGain(index, value)}
          />
        ))}
      </View>

      <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>声像</Text>
      <ValueSlider
        value={pan}
        steps={PAN_STEPS}
        format={(v) => (v === 0 ? "中" : v < 0 ? `左 ${Math.abs(v).toFixed(2)}` : `右 ${v.toFixed(2)}`)}
        palette={palette}
        disabled={!enabled}
        onChange={(value) => void setPan(value)}
      />

      <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>混响</Text>
      <ValueSlider
        value={reverbMix}
        steps={REVERB_STEPS}
        format={(v) => `${Math.round(v * 100)}%`}
        palette={palette}
        disabled={!enabled}
        onChange={(value) => void setReverbMix(value)}
      />

      <Text style={[styles.footnote, { color: palette.textMuted }]}>
        变调依赖桌面 WebAudio，移动端 Android 内置音效链路不支持独立 Pitch Shift。
      </Text>
    </SettingsCard>
  );
}

interface EqBandProps {
  freq: number;
  gain: number;
  palette: ThemePalette;
  disabled: boolean;
  onChange: (value: number) => void;
}

function EqBand({ freq, gain, palette, disabled, onChange }: EqBandProps) {
  return (
    <View style={styles.eqBand}>
      <Text style={[styles.eqFreqLabel, { color: palette.textMuted }]}>{formatFreq(freq)}</Text>
      <View style={styles.eqStepColumn}>
        {[...GAIN_STEPS].reverse().map((step) => {
          const active = Math.abs(gain - step) < 0.001;
          return (
            <Pressable
              key={step}
              disabled={disabled}
              onPress={() => onChange(step)}
              style={[
                styles.eqStep,
                { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                active && { backgroundColor: palette.primary, borderColor: palette.primary },
              ]}
            >
              <Text
                style={[
                  styles.eqStepText,
                  { color: active ? palette.primaryText : palette.textMuted },
                ]}
              >
                {step > 0 ? `+${step}` : `${step}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.eqGainLabel, { color: palette.text }]}>
        {gain > 0 ? `+${gain}` : `${gain}`}dB
      </Text>
    </View>
  );
}

interface ValueSliderProps {
  value: number;
  steps: number[];
  format: (value: number) => string;
  palette: ThemePalette;
  disabled: boolean;
  onChange: (value: number) => void;
}

function ValueSlider({ value, steps, format, palette, disabled, onChange }: ValueSliderProps) {
  return (
    <View style={styles.sliderWrap}>
      <View style={styles.sliderRow}>
        {steps.map((step) => {
          const active = Math.abs(value - step) < 0.001;
          return (
            <Pressable
              key={step}
              disabled={disabled}
              onPress={() => onChange(step)}
              style={[
                styles.sliderStep,
                { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
                active && { backgroundColor: palette.primary, borderColor: palette.primary },
              ]}
            >
              <Text style={[styles.sliderStepText, { color: active ? palette.primaryText : palette.text }]}>
                {format(step)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.sliderValueText, { color: palette.textMuted }]}>当前 {format(value)}</Text>
    </View>
  );
}

function formatFreq(freq: number): string {
  if (freq >= 1000) return `${(freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 1)}k`;
  return `${freq}`;
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.s,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 3,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  hint: {
    fontSize: 12,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  resetBtn: {
    minHeight: touch.minTarget,
    paddingHorizontal: spacing.s,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
  resetText: {
    fontSize: 12,
    fontWeight: "600",
  },
  enableBtn: {
    minHeight: touch.minTarget,
    paddingHorizontal: spacing.s,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 72,
    alignItems: "center",
  },
  enableText: {
    fontSize: 12,
    fontWeight: "700",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
    letterSpacing: 0.4,
  },
  presetRow: {
    gap: 8,
    paddingRight: 4,
    paddingVertical: 2,
  },
  presetChip: {
    minHeight: touch.minTarget,
    paddingHorizontal: spacing.s,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
  presetText: {
    fontSize: 12,
    fontWeight: "700",
  },
  eqGroup: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 6,
  },
  eqBand: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  eqFreqLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  eqStepColumn: {
    gap: 3,
    alignItems: "center",
  },
  eqStep: {
    minWidth: 42,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: "center",
  },
  eqStepText: {
    fontSize: 10,
    fontWeight: "700",
  },
  eqGainLabel: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  sliderWrap: {
    gap: 8,
  },
  sliderRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  sliderStep: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  sliderStepText: {
    fontSize: 12,
    fontWeight: "700",
  },
  sliderValueText: {
    fontSize: 11,
  },
  footnote: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});
