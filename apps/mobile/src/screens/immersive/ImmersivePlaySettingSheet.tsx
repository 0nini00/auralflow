import React from "react";
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

/** 倍速值域：0.5x-2.0x，步进 0.25（对齐 playerRateModel 边界） */
const RATE_MIN = 0.5;
const RATE_MAX = 2;
const RATE_STEP = 0.25;

/** 行距值域：0-24px，步进 2 */
const LINE_GAP_MIN = 0;
const LINE_GAP_MAX = 24;
const LINE_GAP_STEP = 2;

/** 歌词偏移值域：±0.5s（±500ms），步进 50ms（与 lyricSettingsStore 收敛逻辑一致） */
const OFFSET_MIN = -500;
const OFFSET_MAX = 500;
const OFFSET_STEP = 50;

function formatRateLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}x`;
}

function formatOffsetLabel(ms: number): string {
  if (ms === 0) return "0s";
  const seconds = Number((Math.abs(ms) / 1000).toFixed(2)).toString();
  return `${ms > 0 ? "+" : "-"}${seconds}s`;
}

export interface ImmersivePlaySettingSheetProps {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
}

/**
 * 播放设置弹窗：只收「播放中即时调整」项——倍速 / 歌词字号 / 行距 / 歌词偏移
 * 校准 / 歌词对齐。全部使用直接点按控件（档位 chips / 步进按钮），不用拖动条。
 *
 * 音量不在面板内提供（跟随系统音量键，避免与系统音量争夺）；音量档位与静音
 * 快捷入口如后续需要可另接入。
 *
 * 歌词外观开关（封面页迷你歌词 / 封面旋转 / 氛围色背景）与完整样式（颜色 /
 * 字体 / 译文 / 动画）统一收在「设置 → 歌词」：同一设置只保留一个入口，避免
 * 两处各改一份、且同名不同义（此处旧称"歌词进度"，设置页叫"封面页迷你歌词"）。
 * 字号/行距/对齐/偏移是即时调整：听着歌预览歌词可读性与音画同步是沉浸页场景
 * 独有的价值，且设置页没有这些项，不构成重合。音质只收设置页「设置 → 播放」
 * 的默认音质（持久化来源，同时驱动下载默认音质），沉浸页不再提供当前曲切换。
 */
export function ImmersivePlaySettingSheet({
  visible,
  onClose,
  palette,
}: ImmersivePlaySettingSheetProps) {
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);
  const fontSize = useLyricSettingsStore((s) => s.fontSize);
  const setFontSize = useLyricSettingsStore((s) => s.setFontSize);
  const lineGap = useLyricSettingsStore((s) => s.lineGap);
  const setLineGap = useLyricSettingsStore((s) => s.setLineGap);
  const manualOffsetMs = useLyricSettingsStore((s) => s.manualOffsetMs);
  const setManualOffset = useLyricSettingsStore((s) => s.setManualOffset);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.title, { color: palette.text }]}>播放设置</Text>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* 倍速：步进按钮，1 步 0.25x（值域 0.5x-2.0x，与 playerRateModel 边界一致） */}
            <StepperRow
              label="倍速"
              valueLabel={formatRateLabel(playbackRate)}
              palette={palette}
              canDecrement={playbackRate > RATE_MIN}
              canIncrement={playbackRate < RATE_MAX}
              onDecrement={() =>
                setPlaybackRate(Math.max(RATE_MIN, Math.round((playbackRate - RATE_STEP) / RATE_STEP) * RATE_STEP))
              }
              onIncrement={() =>
                setPlaybackRate(Math.min(RATE_MAX, Math.round((playbackRate + RATE_STEP) / RATE_STEP) * RATE_STEP))
              }
            />

            {/* 歌词字号：步进按钮，1 步 1px */}
            <StepperRow
              label="字号"
              valueLabel={`${fontSize}`}
              palette={palette}
              canDecrement={fontSize > LYRIC_FONT_SIZE_MIN}
              canIncrement={fontSize < LYRIC_FONT_SIZE_MAX}
              onDecrement={() => setFontSize(Math.max(LYRIC_FONT_SIZE_MIN, fontSize - 1))}
              onIncrement={() => setFontSize(Math.min(LYRIC_FONT_SIZE_MAX, fontSize + 1))}
            />

            {/* 歌词行距：步进按钮，1 步 2px */}
            <StepperRow
              label="行距"
              valueLabel={`${lineGap}`}
              palette={palette}
              canDecrement={lineGap > LINE_GAP_MIN}
              canIncrement={lineGap < LINE_GAP_MAX}
              onDecrement={() => setLineGap(Math.max(LINE_GAP_MIN, lineGap - LINE_GAP_STEP))}
              onIncrement={() => setLineGap(Math.min(LINE_GAP_MAX, lineGap + LINE_GAP_STEP))}
            />

            {/* 歌词对齐设置已移除：歌词统一居中（见 lyricSettingsStore merge） */}

            {/* 歌词偏移校准：±0.5s（±500ms），步进 0.05s；正=歌词提前，负=延后 */}
            <StepperRow
              label="歌词偏移"
              valueLabel={formatOffsetLabel(manualOffsetMs)}
              palette={palette}
              canDecrement={manualOffsetMs > OFFSET_MIN}
              canIncrement={manualOffsetMs < OFFSET_MAX}
              onDecrement={() => setManualOffset(Math.max(OFFSET_MIN, manualOffsetMs - OFFSET_STEP))}
              onIncrement={() => setManualOffset(Math.min(OFFSET_MAX, manualOffsetMs + OFFSET_STEP))}
            >
              {manualOffsetMs !== 0 ? (
                <Pressable
                  onPress={() => setManualOffset(0)}
                  style={[styles.reset, { backgroundColor: palette.surfaceMuted }]}
                >
                  <Text style={[styles.resetText, { color: palette.primary }]}>归零</Text>
                </Pressable>
              ) : null}
            </StepperRow>

          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

interface StepperRowProps {
  label: string;
  valueLabel: string;
  palette: ThemePalette;
  canDecrement: boolean;
  canIncrement: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
  children?: React.ReactNode;
}

/** 步进行：−/＋ 按钮 + 数值，附带的 children（如「归零」）放在数值右侧。 */
function StepperRow({
  label,
  valueLabel,
  palette,
  canDecrement,
  canIncrement,
  onDecrement,
  onIncrement,
  children,
}: StepperRowProps) {
  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
      <View style={styles.stepperGroup}>
        <Pressable
          onPress={onDecrement}
          disabled={!canDecrement}
          style={[
            styles.stepBtn,
            { backgroundColor: canDecrement ? palette.surfaceMuted : palette.background },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${label}减小`}
        >
          <Text style={[styles.stepBtnText, { color: canDecrement ? palette.text : palette.textMuted }]}>
            −
          </Text>
        </Pressable>
        <Text style={[styles.valueLabel, { color: palette.textMuted }]}>{valueLabel}</Text>
        <Pressable
          onPress={onIncrement}
          disabled={!canIncrement}
          style={[
            styles.stepBtn,
            { backgroundColor: canIncrement ? palette.surfaceMuted : palette.background },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${label}增大`}
        >
          <Text style={[styles.stepBtnText, { color: canIncrement ? palette.text : palette.textMuted }]}>
            +
          </Text>
        </Pressable>
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
  stepperGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    fontSize: typography.title,
    fontWeight: "700",
    lineHeight: typography.title,
  },
  valueLabel: {
    fontSize: typography.meta,
    fontWeight: "600",
    minWidth: 44,
    textAlign: "center",
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
});
