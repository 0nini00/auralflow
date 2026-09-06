import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import type { ThemePalette } from "@/stores/themeStore";
import { radius, typography } from "@/theme/tokens";
import {
  useLyricSettingsStore,
  LYRIC_FONT_SIZE_MIN,
  LYRIC_FONT_SIZE_MAX,
} from "@/stores/lyricSettingsStore";
import { usePlayerStore } from "@/stores/playerStore";
import { PaletteSlider } from "@/components/settings/PaletteSlider";
import {
  normalizePlaybackQuality,
  PLAYBACK_QUALITY_OPTIONS,
  type PlaybackQuality,
} from "@/services/playbackQualityModel";
import { switchCurrentPlaybackQuality } from "@/services/playerService";

const ALIGN_OPTIONS = [
  { label: "左对齐", value: "left" as const },
  { label: "居中", value: "center" as const },
  { label: "右对齐", value: "right" as const },
];

/** 音质 chips 的短标签（PLAYBACK_QUALITY_OPTIONS 的 label 面向设置页，这里空间有限） */
const QUALITY_CHIP_LABELS: Record<PlaybackQuality, string> = {
  "128k": "128K",
  "192k": "192K",
  "320k": "320K",
  flac: "FLAC",
  flac24bit: "Hi-Res",
};

function formatOffsetLabel(ms: number): string {
  if (ms === 0) return "0s";
  return `${ms > 0 ? "+" : "-"}${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

export interface ImmersivePlaySettingSheetProps {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
}

/**
 * 播放设置弹窗：只收「播放中即时调整」项——音量 / 倍速 / 歌词字号 / 行距 /
 * 歌词偏移校准 / 歌词对齐 / 当前曲音质。
 *
 * 歌词外观开关（封面页迷你歌词 / 封面旋转 / 氛围色背景）与完整样式（颜色 /
 * 字体 / 译文 / 动画）统一收在「设置 → 歌词」：同一设置只保留一个入口，避免
 * 两处各改一份、且同名不同义（此处旧称"歌词进度"，设置页叫"封面页迷你歌词"）。
 * 字号/行距/对齐/偏移是即时调整：听着歌预览歌词可读性与音画同步是沉浸页场景
 * 独有的价值，且设置页没有这些项，不构成重合。音质切换只作用于当前曲
 * （设置页的"默认音质"管以后播放的歌），与桌面播放页能力对齐。
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
  const currentSong = usePlayerStore((s) => s.currentSong);

  const fontSize = useLyricSettingsStore((s) => s.fontSize);
  const setFontSize = useLyricSettingsStore((s) => s.setFontSize);
  const lineGap = useLyricSettingsStore((s) => s.lineGap);
  const setLineGap = useLyricSettingsStore((s) => s.setLineGap);
  const textAlign = useLyricSettingsStore((s) => s.textAlign);
  const setTextAlign = useLyricSettingsStore((s) => s.setTextAlign);
  const manualOffsetMs = useLyricSettingsStore((s) => s.manualOffsetMs);
  const setManualOffset = useLyricSettingsStore((s) => s.setManualOffset);

  const [qualitySwitchError, setQualitySwitchError] = useState<string | null>(null);

  const volumeToPct = Math.round(volume * 100);
  const ratePct = Math.round(playbackRate * 100);

  // 与 switchCurrentPlaybackQuality 的门槛一致：本地/B站源不支持音质切换
  const qualitySwitchable =
    currentSong != null && !currentSong.isLocal && currentSong.source !== "local" && currentSong.source !== "bili";
  const effectiveQuality = qualitySwitchable ? normalizePlaybackQuality(currentSong.quality) : null;

  const handleQualitySwitch = useCallback(
    (next: PlaybackQuality) => {
      if (next === effectiveQuality) return;
      setQualitySwitchError(null);
      void switchCurrentPlaybackQuality(next).catch((error: unknown) => {
        setQualitySwitchError(error instanceof Error ? error.message : "音质切换失败");
      });
    },
    [effectiveQuality],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.title, { color: palette.text }]}>播放设置</Text>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
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
              onChange={setFontSize}
            />

            {/* 歌词行距 */}
            <SliderRow
              label="行距"
              valueLabel={`${lineGap}px`}
              min={0}
              max={24}
              step={2}
              value={lineGap}
              palette={palette}
              onChange={setLineGap}
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

            {/* 歌词偏移校准：正=歌词提前，负=延后；音画不同步时边听边校 */}
            <SliderRow
              label="歌词偏移"
              valueLabel={formatOffsetLabel(manualOffsetMs)}
              min={-5000}
              max={5000}
              step={250}
              value={manualOffsetMs}
              palette={palette}
              onChange={setManualOffset}
            >
              {manualOffsetMs !== 0 ? (
                <Pressable
                  onPress={() => setManualOffset(0)}
                  style={[styles.reset, { backgroundColor: palette.surfaceMuted }]}
                >
                  <Text style={[styles.resetText, { color: palette.primary }]}>归零</Text>
                </Pressable>
              ) : null}
            </SliderRow>

            {/* 当前曲音质：只切本曲，设置页「默认音质」管以后播放的歌 */}
            {qualitySwitchable ? (
              <>
                <Row label="音质" palette={palette}>
                  <View style={[styles.alignRow, styles.qualityRow]}>
                    {PLAYBACK_QUALITY_OPTIONS.map((option) => {
                      const selected = effectiveQuality === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => handleQualitySwitch(option.value)}
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
                            {QUALITY_CHIP_LABELS[option.value]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </Row>
                {qualitySwitchError ? (
                  <Text style={[styles.switchError, { color: palette.textMuted }]}>
                    音质切换失败：{qualitySwitchError}
                  </Text>
                ) : null}
              </>
            ) : null}

            <Text style={[styles.hint, { color: palette.textMuted }]}>
              歌词颜色、字体与外观开关在「设置 → 歌词」中调整
            </Text>
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
  /** 吸附步长；缺省按 (max-min)/40 */
  step?: number;
  value: number;
  palette: ThemePalette;
  onChange: (value: number) => void;
  children?: React.ReactNode;
}

/** 内联滑块行：一列可拖拽轨道 + 圆点 + 实时数值标签，滑块核心共用 PaletteSlider。 */
function SliderRow({ label, valueLabel, min, max, step, value, palette, onChange, children }: SliderRowProps) {
  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
      <View style={styles.sliderGroup}>
        <PaletteSlider
          style={styles.sliderTrackWrap}
          value={value}
          min={min}
          max={max}
          step={step}
          palette={palette}
          onChange={onChange}
        />
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
    width: 126,
  },
  qualityRow: {
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  switchError: {
    fontSize: typography.caption,
    paddingVertical: 6,
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
  hint: {
    fontSize: typography.caption,
    paddingTop: 12,
    paddingBottom: 4,
    textAlign: "center",
  },
});