import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Switch,
  Modal,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";

import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
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
import { radius, touch, typography } from "@/theme/tokens";

export interface LyricSettingsScreenProps {
  visible: boolean;
  onBack: () => void;
}

export interface LyricSettingsContentProps {
  onBack: () => void;
}

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 28;
const LINE_GAP_MIN = 4;
const LINE_GAP_MAX = 20;
const TEXT_OPACITY_MIN = 0.2;
const TEXT_OPACITY_MAX = 1;
const OFFSET_MIN = -2000;
const OFFSET_MAX = 2000;
/** 滑块刻度数（用于按比例计算数值） */
const SLIDER_STEPS = 40;
const ALIGN_OPTIONS = [
  { label: "左对齐", value: "left" },
  { label: "居中", value: "center" },
  { label: "右对齐", value: "right" },
] as const;
const FONT_WEIGHT_OPTIONS = [
  { label: "常规", value: 500 },
  { label: "加粗", value: 700 },
  { label: "强调", value: 800 },
] as const;
const ANIMATION_INTENSITY_OPTIONS = [
  { label: "柔和", value: "reduced" },
  { label: "标准", value: "normal" },
  { label: "增强", value: "enhanced" },
] as const;

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

export function LyricSettingsContent({ onBack }: LyricSettingsContentProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const mode = useThemeStore((s) => s.mode);
  const systemTheme = useThemeStore((s) => s.systemTheme);
  const accentColor = useThemeStore((s) => s.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const fontSize = useLyricSettingsStore((s) => s.fontSize);
  const showTranslation = useLyricSettingsStore((s) => s.showTranslation);
  const activeColor = useLyricSettingsStore((s) => s.activeColor);
  const inactiveColor = useLyricSettingsStore((s) => s.inactiveColor);
  const lineGap = useLyricSettingsStore((s) => s.lineGap);
  const fontFamily = useLyricSettingsStore((s) => s.fontFamily);
  const textAlign = useLyricSettingsStore((s) => s.textAlign);
  const fontWeight = useLyricSettingsStore((s) => s.fontWeight);
  const textOpacity = useLyricSettingsStore((s) => s.textOpacity);
  const enableAnimation = useLyricSettingsStore((s) => s.enableAnimation);
  const animationIntensity = useLyricSettingsStore((s) => s.animationIntensity);
  const manualOffsetMs = useLyricSettingsStore((s) => s.manualOffsetMs);

  const setFontSize = useLyricSettingsStore((s) => s.setFontSize);
  const setShowTranslation = useLyricSettingsStore((s) => s.setShowTranslation);
  const setActiveColor = useLyricSettingsStore((s) => s.setActiveColor);
  const setInactiveColor = useLyricSettingsStore((s) => s.setInactiveColor);
  const setLineGap = useLyricSettingsStore((s) => s.setLineGap);
  const setFontFamily = useLyricSettingsStore((s) => s.setFontFamily);
  const setTextAlign = useLyricSettingsStore((s) => s.setTextAlign);
  const setFontWeight = useLyricSettingsStore((s) => s.setFontWeight);
  const setTextOpacity = useLyricSettingsStore((s) => s.setTextOpacity);
  const setEnableAnimation = useLyricSettingsStore((s) => s.setEnableAnimation);
  const setAnimationIntensity = useLyricSettingsStore((s) => s.setAnimationIntensity);
  const setManualOffset = useLyricSettingsStore((s) => s.setManualOffset);
  const resetSettings = useLyricSettingsStore((s) => s.resetSettings);

  const sliderWidth = Math.min(width - 64, 360);

  return (
      <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
        <ScreenScaffold style={styles.scaffold}>
        {/* 顶部栏 */}
        <View style={[styles.topBar, { borderBottomColor: palette.border }]}>
          <Pressable
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="关闭歌词设置"
          >
            <ChevronLeft size={20} strokeWidth={2} color={palette.text} />
          </Pressable>
          <Text style={[styles.title, { color: palette.text }]}>歌词样式</Text>
          <Pressable
            onPress={() => void resetSettings()}
            style={styles.resetButton}
            hitSlop={8}
          >
            <Text style={[styles.resetButtonText, { color: palette.primary }]}>恢复默认样式</Text>
          </Pressable>
        </View>

        <ScreenScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        >
          {/* 字号 */}
          <Section title="字号" palette={palette}>
            <Slider
              width={sliderWidth}
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              value={fontSize}
              palette={palette}
              onChange={setFontSize}
            />
            <Text style={[styles.valueLabel, { color: palette.textMuted }]}>{fontSize}px</Text>
          </Section>

          {/* 行间距 */}
          <Section title="行间距" palette={palette}>
            <Slider
              width={sliderWidth}
              min={LINE_GAP_MIN}
              max={LINE_GAP_MAX}
              value={lineGap}
              palette={palette}
              onChange={setLineGap}
            />
            <Text style={[styles.valueLabel, { color: palette.textMuted }]}>{lineGap}px</Text>
          </Section>

          <Section title="其他行透明度" palette={palette}>
            <Slider
              width={sliderWidth}
              min={TEXT_OPACITY_MIN}
              max={TEXT_OPACITY_MAX}
              value={textOpacity}
              palette={palette}
              onChange={setTextOpacity}
            />
            <Text style={[styles.valueLabel, { color: palette.textMuted }]}>{Math.round(textOpacity * 100)}%</Text>
          </Section>

          {/* 歌词偏移校准 */}
          <Section title="歌词偏移校准" palette={palette}>
            <Slider
              width={sliderWidth}
              min={OFFSET_MIN}
              max={OFFSET_MAX}
              value={manualOffsetMs}
              palette={palette}
              onChange={setManualOffset}
            />
            <Text style={[styles.valueLabel, { color: palette.textMuted }]}>
              {manualOffsetMs > 0 ? `+${manualOffsetMs}` : `${manualOffsetMs}`} ms（正=提前，负=延后）
            </Text>
          </Section>


          {/* 译文开关 */}
          <View style={[styles.row, { backgroundColor: palette.surface }]}>
            <Text style={[styles.rowLabel, { color: palette.text }]}>显示译文</Text>
            <Switch
              value={showTranslation}
              onValueChange={setShowTranslation}
              trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
              thumbColor={showTranslation ? palette.primaryText : palette.textMuted}
            />
          </View>

          <View style={[styles.row, { backgroundColor: palette.surface }]}>
            <Text style={[styles.rowLabel, { color: palette.text }]}>切换动画</Text>
            <Switch
              value={enableAnimation}
              onValueChange={setEnableAnimation}
              trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
              thumbColor={enableAnimation ? palette.primaryText : palette.textMuted}
            />
          </View>

          <Section title="对齐" palette={palette}>
            <View style={styles.optionGrid}>
              {ALIGN_OPTIONS.map((option) => {
                const selected = textAlign === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setTextAlign(option.value)}
                    style={[
                      styles.optionChip,
                      {
                        backgroundColor: selected ? palette.primary : palette.surface,
                        borderColor: selected ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Text style={[styles.optionChipText, { color: selected ? palette.primaryText : palette.text }]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          <Section title="当前行字重" palette={palette}>
            <View style={styles.optionGrid}>
              {FONT_WEIGHT_OPTIONS.map((option) => {
                const selected = fontWeight === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setFontWeight(option.value)}
                    style={[
                      styles.optionChip,
                      {
                        backgroundColor: selected ? palette.primary : palette.surface,
                        borderColor: selected ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        {
                          color: selected ? palette.primaryText : palette.text,
                          fontWeight: String(option.value) as "500" | "700" | "800",
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          <Section title="动效强度" palette={palette}>
            <View style={styles.optionGrid}>
              {ANIMATION_INTENSITY_OPTIONS.map((option) => {
                const selected = animationIntensity === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setAnimationIntensity(option.value)}
                    style={[
                      styles.optionChip,
                      {
                        backgroundColor: selected ? palette.primary : palette.surface,
                        borderColor: selected ? palette.primary : palette.border,
                        opacity: enableAnimation ? 1 : 0.45,
                      },
                    ]}
                    disabled={!enableAnimation}
                  >
                    <Text style={[styles.optionChipText, { color: selected ? palette.primaryText : palette.text }]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          {/* 当前行颜色 */}
          <Section title="当前行颜色" palette={palette}>
            <ColorPicker
              presets={ACTIVE_COLOR_PRESETS}
              value={activeColor}
              fallbackColor={palette.primary}
              palette={palette}
              onSelect={setActiveColor}
            />
          </Section>

          {/* 其他行颜色 */}
          <Section title="其他行颜色" palette={palette}>
            <ColorPicker
              presets={INACTIVE_COLOR_PRESETS}
              value={inactiveColor}
              fallbackColor={palette.textMuted}
              palette={palette}
              onSelect={setInactiveColor}
            />
          </Section>

          {/* 字体 */}
          <Section title="字体" palette={palette}>
            <View style={styles.fontGrid}>
              {FONT_OPTIONS.map((opt) => {
                const selected = fontFamily === opt.value;
                return (
                  <Pressable
                    key={opt.value || "system"}
                    onPress={() => setFontFamily(opt.value)}
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
          <Section title="预览" palette={palette}>
            <View style={[styles.previewBox, { backgroundColor: palette.surface }]}>
              <Text
                style={[
                  styles.previewActive,
                  {
                    color: activeColor || palette.primary,
                    fontSize,
                    fontFamily: fontFamily || undefined,
                    fontWeight: String(fontWeight) as "500" | "700" | "800",
                    textAlign,
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
                    textAlign,
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
                      textAlign,
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
  palette: ThemePalette;
  children: React.ReactNode;
}

function Section({ title, palette, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} style={styles.sectionHeader} />
      <View style={[styles.sectionBody, { backgroundColor: palette.surface }]}>
        {children}
      </View>
    </View>
  );
}

interface SliderProps {
  width: number;
  min: number;
  max: number;
  value: number;
  palette: ThemePalette;
  onChange: (v: number) => void;
}

/** 自定义滑块：用一行可点击的轨道 + 拖拽圆点实现，避免引入额外依赖 */
function Slider({ width, min, max, value, palette, onChange }: SliderProps) {
  const trackRef = React.useRef<View>(null);
  const stepRef = React.useRef((max - min) / SLIDER_STEPS);

  const ratio = (value - min) / (max - min);
  const thumbSize = 22;
  const trackHeight = 4;
  const usableWidth = width - thumbSize;

  const updateFromPageX = (pageX: number) => {
    trackRef.current?.measure((_x, _y, w) => {
      const localX = pageX - (w - usableWidth) / 2 - thumbSize / 2;
      const r = Math.max(0, Math.min(1, localX / usableWidth));
      const step = stepRef.current;
      const snapped = Math.round((min + r * (max - min)) / step) * step;
      const clamped = Math.max(min, Math.min(max, snapped));
      onChange(Math.round(clamped * 100) / 100);
    });
  };

  const handlePress = (e: any) => {
    updateFromPageX(e.nativeEvent.pageX);
  };

  return (
    <View
      ref={trackRef}
      style={{ width, height: thumbSize, justifyContent: "center" }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={handlePress}
      onResponderMove={handlePress}
    >
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: trackHeight,
          borderRadius: trackHeight / 2,
          backgroundColor: palette.surfaceMuted,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 0,
          width: Math.max(thumbSize / 2, usableWidth * ratio + thumbSize / 2),
          height: trackHeight,
          borderRadius: trackHeight / 2,
          backgroundColor: palette.primary,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: usableWidth * ratio,
          width: thumbSize,
          height: thumbSize,
          borderRadius: thumbSize / 2,
          backgroundColor: palette.primaryText,
          borderWidth: 2,
          borderColor: palette.primary,
        }}
      />
    </View>
  );
}

interface ColorPickerProps {
  presets: Array<{ label: string; value: string }>;
  value: string;
  fallbackColor: string;
  palette: ThemePalette;
  onSelect: (v: string) => void;
}

function ColorPicker({ presets, value, fallbackColor, palette, onSelect }: ColorPickerProps) {
  return (
    <View style={styles.colorRow}>
      {presets.map((p) => {
        const selected = value === p.value;
        const swatchColor = p.value || fallbackColor;
        return (
          <Pressable
            key={p.label}
            onPress={() => onSelect(p.value)}
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
  backButton: {
    minWidth: touch.minTarget,
    minHeight: touch.minTarget,
    borderRadius: radius.xl,
    justifyContent: "center",
    alignItems: "center",
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
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    marginBottom: 8,
  },
  sectionBody: {
    borderRadius: radius.md,
    padding: 16,
  },
  valueLabel: {
    fontSize: typography.meta,
    marginTop: 8,
    textAlign: "right",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
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
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  optionChip: {
    minWidth: 86,
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionChipText: {
    fontSize: typography.body,
    fontWeight: "600",
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
    padding: 16,
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
