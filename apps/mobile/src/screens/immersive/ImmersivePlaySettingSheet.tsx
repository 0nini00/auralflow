import React, { useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Switch,
  Modal,
  ScrollView,
  StyleSheet,
  type LayoutChangeEvent,
} from "react-native";
import type { ThemePalette } from "@/stores/themeStore";
import { radius, typography } from "@/theme/tokens";
import {
  useLyricSettingsStore,
  LYRIC_FONT_SIZE_MIN,
  LYRIC_FONT_SIZE_MAX,
} from "@/stores/lyricSettingsStore";
import { usePlayerStore } from "@/stores/playerStore";

/** 滑块刻度数（用于按比例计算数值） */
const SLIDER_STEPS = 40;

const ALIGN_OPTIONS = [
  { label: "左对齐", value: "left" as const },
  { label: "居中", value: "center" as const },
  { label: "右对齐", value: "right" as const },
];

export interface ImmersivePlaySettingSheetProps {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
}

/**
 * 播放设置弹窗，对齐 lx SettingPopup 的 6 项内联列表：
 * 歌词进度 / 音量 / 倍速 / 歌词字号 / 歌词对齐 / 封面旋转。
 * 值直读 playerStore 与 lyricSettingsStore，实时联动。
 */
export function ImmersivePlaySettingSheet({
  visible,
  onClose,
  palette,
}: ImmersivePlaySettingSheetProps) {
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);

  const showLyricProgress = useLyricSettingsStore((s) => s.showLyricProgress);
  const setShowLyricProgress = useLyricSettingsStore((s) => s.setShowLyricProgress);
  const fontSize = useLyricSettingsStore((s) => s.fontSize);
  const setFontSize = useLyricSettingsStore((s) => s.setFontSize);
  const textAlign = useLyricSettingsStore((s) => s.textAlign);
  const setTextAlign = useLyricSettingsStore((s) => s.setTextAlign);
  const coverSpin = useLyricSettingsStore((s) => s.coverSpin);
  const setCoverSpin = useLyricSettingsStore((s) => s.setCoverSpin);
  const ambientCoverTint = useLyricSettingsStore((s) => s.ambientCoverTint);
  const setAmbientCoverTint = useLyricSettingsStore((s) => s.setAmbientCoverTint);

  const volumeToPct = Math.round(volume * 100);
  const ratePct = Math.round(playbackRate * 100);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.title, { color: palette.text }]}>播放设置</Text>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* 歌词进度 */}
            <Row label="歌词进度" palette={palette}>
              <Switch
                value={showLyricProgress}
                onValueChange={setShowLyricProgress}
                trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
                thumbColor={showLyricProgress ? palette.primaryText : palette.textMuted}
              />
            </Row>

            {/* 音量：onChange 收到 0-100 整数值，/100 得 0-1 */}
            <SliderRow
              label="音量"
              valueLabel={`${volumeToPct}%`}
              min={0}
              max={100}
              value={volumeToPct}
              palette={palette}
              onChange={(v) => void setVolume(v / 100)}
            />

            {/* 倍速：值域 0.6x-2.0x（60-200），/100 得实际倍率 */}
            <SliderRow
              label="倍速"
              valueLabel={`${playbackRate.toFixed(2)}x`}
              min={60}
              max={200}
              value={ratePct}
              palette={palette}
              onChange={(v) => void setPlaybackRate(Number((v / 100).toFixed(2)))}
            >
              {ratePct !== 100 ? (
                <Pressable
                  onPress={() => void setPlaybackRate(1)}
                  style={[styles.reset, { backgroundColor: palette.surfaceMuted }]}
                >
                  <Text style={[styles.resetText, { color: palette.primary }]}>重置</Text>
                </Pressable>
              ) : null}
            </SliderRow>

            {/* 歌词字号 */}
            <SliderRow
              label="字号"
              valueLabel={`${fontSize}px`}
              min={LYRIC_FONT_SIZE_MIN}
              max={LYRIC_FONT_SIZE_MAX}
              value={fontSize}
              palette={palette}
              onChange={(v) => setFontSize(v)}
            />

            {/* 歌词对齐 */}
            <Row label="对齐" palette={palette}>
              <View style={styles.alignRow}>
                {ALIGN_OPTIONS.map((opt) => {
                  const selected = textAlign === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setTextAlign(opt.value)}
                      style={[
                        styles.alignChip,
                        {
                          backgroundColor: selected ? palette.primary : palette.surfaceMuted,
                          borderColor: selected ? palette.primary : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.alignChipText,
                          { color: selected ? palette.primaryText : palette.text },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Row>

            {/* 封面旋转 */}
            <Row label="封面旋转" palette={palette}>
              <Switch
                value={coverSpin}
                onValueChange={setCoverSpin}
                trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
                thumbColor={coverSpin ? palette.primaryText : palette.textMuted}
              />
            </Row>

            {/* 氛围色背景：封面主色给沉浸页染色（默认关，保持 lx 纯色背景） */}
            <Row label="氛围色背景" palette={palette}>
              <Switch
                value={ambientCoverTint}
                onValueChange={setAmbientCoverTint}
                trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
                thumbColor={ambientCoverTint ? palette.primaryText : palette.textMuted}
              />
            </Row>
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

interface RowProps {
  label: string;
  palette: ThemePalette;
  children: React.ReactNode;
}

function Row({ label, palette, children }: RowProps) {
  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
      {children}
    </View>
  );
}

interface SliderRowProps {
  label: string;
  valueLabel: string;
  min: number;
  max: number;
  value: number;
  palette: ThemePalette;
  onChange: (value: number, pct: number) => void;
  children?: React.ReactNode;
}

/** 内联滑块行：一列可拖拽轨道 + 圆点 + 实时数值标签。
 * 轨道宽度动态实测（onLayout），thumb/fill 不再按硬编码宽度计算，
 * 修复滑块在窄轨道上错位/溢出的问题。 */
function SliderRow({ label, valueLabel, min, max, value, palette, onChange, children }: SliderRowProps) {
  const trackRef = useRef<View>(null);
  const stepRef = useRef((max - min) / SLIDER_STEPS);
  const [trackW, setTrackW] = useState(0);

  const thumbSize = 22;
  const usableWidth = Math.max(0, trackW - thumbSize);
  const ratio = trackW > 0 ? (value - min) / (max - min) : 0;

  const updateFromPageX = (pageX: number) => {
    if (usableWidth <= 0) return;
    trackRef.current?.measure((_x, _y, _w, _h, pageX0) => {
      const localX = pageX - pageX0 - thumbSize / 2;
      const r = Math.max(0, Math.min(1, localX / usableWidth));
      const snapped = Math.round((min + r * (max - min)) / stepRef.current) * stepRef.current;
      const clamped = Math.max(min, Math.min(max, snapped));
      onChange(clamped, (clamped - min) / (max - min));
    });
  };

  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
      <View style={styles.sliderGroup}>
        <View
          ref={trackRef}
          style={styles.sliderTrackWrap}
          onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => updateFromPageX(e.nativeEvent.pageX)}
          onResponderMove={(e) => updateFromPageX(e.nativeEvent.pageX)}
        >
          <View
            style={[
              styles.sliderTrack,
              { backgroundColor: palette.surfaceMuted },
            ]}
          />
          <View
            style={[
              styles.sliderFill,
              {
                backgroundColor: palette.primary,
                width: Math.max(thumbSize / 2, usableWidth * ratio + thumbSize / 2),
              },
            ]}
          />
          <View
            style={[
              styles.sliderThumb,
              {
                left: usableWidth * ratio,
                backgroundColor: palette.primaryText,
                borderColor: palette.primary,
              },
            ]}
          />
        </View>
        <Text style={[styles.valueLabel, { color: palette.textMuted }]}>{valueLabel}</Text>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    maxHeight: "80%",
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
  },
  title: {
    fontSize: typography.title,
    fontWeight: "700",
    paddingBottom: 10,
  },
  scroll: {
    flexGrow: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    fontSize: typography.body,
    fontWeight: "600",
  },
  sliderGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sliderTrackWrap: {
    position: "relative",
    width: 126,
    height: 22,
    justifyContent: "center",
  },
  sliderTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
  },
  sliderThumb: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
  },
  valueLabel: {
    fontSize: typography.meta,
    fontWeight: "600",
    minWidth: 40,
    textAlign: "right",
  },
  reset: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  resetText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
  alignRow: {
    flexDirection: "row",
    gap: 8,
  },
  alignChip: {
    minWidth: 52,
    paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  alignChipText: {
    fontSize: typography.meta,
    fontWeight: "700",
  },
});