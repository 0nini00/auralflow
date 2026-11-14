import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Check,
  Clock,
  Gauge,
  Music2,
  Volume2,
  VolumeX,
} from "lucide-react-native";
import type { ThemePalette } from "@/stores/themeStore";
import type { MusicInfo } from "@lx/core";
import { QueueModal } from "@/components/QueueModal";
import { SheetFrame } from "@/components/SheetFrame";
import { Touchable } from "@/components/Touchable";
import { radius, spacing, typography } from "@/theme/tokens";
import { withAlpha } from "@/services/themePaletteModel";
import { hapticLight } from "@/services/hapticService";

export interface ImmersiveModalsProps {
  customMinutes: string | number;
  customSongCount: string | number;
  handleCancelSleepTimer: (...args: any[]) => void;
  handleClearQueue: (...args: any[]) => void;
  handlePlayQueueItem: (...args: any[]) => void;
  handleRemoveQueueItem: (...args: any[]) => void;
  handleSetPlaybackRate: (...args: any[]) => void;
  handleSetVolume: (...args: any[]) => void;
  handleStartCustomSleepTimer: (...args: any[]) => void;
  handleStartCustomSongSleepTimer: (...args: any[]) => void;
  handleStartSleepTimer: (...args: any[]) => void;
  handleStartSongSleepTimer: (...args: any[]) => void;
  handleToggleMute: (...args: any[]) => void;
  management: any;
  palette: ThemePalette;
  queueModalVisible: boolean;
  queueModel: any;
  queue: MusicInfo[];
  rateModalVisible: boolean;
  rateModel: any;
  setCustomMinutes: (...args: any[]) => void;
  setCustomSongCount: (...args: any[]) => void;
  setQueueModalVisible: (...args: any[]) => void;
  setRateModalVisible: (...args: any[]) => void;
  setSleepModalVisible: (...args: any[]) => void;
  setVolumeModalVisible: (...args: any[]) => void;
  sleepModalVisible: boolean;
  sleepTimerActive: boolean;
  sleepTimerControl: any;
  sleepTimerMinutes: string | number;
  sleepTimerSongActive: boolean;
  sleepTimerSongCount: string | number;
  volumeModalVisible: boolean;
  volumeModel: any;
  /** 队列菜单内发起路由跳转前回调（播放页场景传 onClose，先关闭覆盖导航栈的 Modal） */
  onQueueNavigate?: () => void;
}

/** 自定义定时输入是否为有效的正数（"0"/非数字/空串均无效，禁用开始按钮） */
function isPositiveNumericInput(value: string | number): boolean {
  if (value === "" || value == null) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function ImmersiveModals({
  customMinutes,
  customSongCount,
  handleCancelSleepTimer,
  handleClearQueue,
  handlePlayQueueItem,
  handleRemoveQueueItem,
  handleSetPlaybackRate,
  handleSetVolume,
  handleStartCustomSleepTimer,
  handleStartCustomSongSleepTimer,
  handleStartSleepTimer,
  handleStartSongSleepTimer,
  handleToggleMute,
  palette,
  queueModalVisible,
  queueModel,
  rateModalVisible,
  rateModel,
  setCustomMinutes,
  setCustomSongCount,
  setQueueModalVisible,
  setRateModalVisible,
  setSleepModalVisible,
  setVolumeModalVisible,
  sleepModalVisible,
  sleepTimerActive,
  sleepTimerControl,
  sleepTimerMinutes,
  sleepTimerSongActive,
  sleepTimerSongCount,
  volumeModalVisible,
  volumeModel,
  queue,
  onQueueNavigate,
}: ImmersiveModalsProps) {
  const customSongCountValid = isPositiveNumericInput(customSongCount);
  const customMinutesValid = isPositiveNumericInput(customMinutes);

  return (
    <>
      {/* ── 1. 倍速调节抽屉 (Bottom Sheet) ── */}
      <SheetFrame
        visible={rateModalVisible}
        onClose={() => setRateModalVisible(false)}
        palette={palette}
        title={rateModel.title || "倍速播放"}
        subtitle="支持 0.5x ~ 2.0x 无级或档位调节"
        icon={Gauge}
        closeLabel="关闭倍速设置"
        scroll={false}
      >
            <View style={styles.optionGrid}>
              {rateModel.options.map((option: any) => {
                const active = option.active;
                return (
                  <Touchable
                    key={option.value}
                    style={[
                      styles.chipOption,
                      {
                        backgroundColor: active
                          ? withAlpha(palette.primaryInk, 0.12)
                          : palette.surfaceMuted,
                        borderColor: active ? palette.primaryInk : "transparent",
                      },
                    ]}
                    onPress={() => {
                      hapticLight();
                      handleSetPlaybackRate(option.value);
                      setRateModalVisible(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`倍速 ${option.label}`}
                  >
                    <Text
                      style={[
                        styles.chipOptionText,
                        {
                          color: active ? palette.primaryInk : palette.text,
                          fontWeight: active ? "700" : "500",
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                    {active ? (
                      <Check size={14} color={palette.primaryInk} style={styles.chipCheck} />
                    ) : null}
                  </Touchable>
                );
              })}
            </View>
      </SheetFrame>

      {/* ── 2. 音量调节抽屉 (Bottom Sheet) ── */}
      <SheetFrame
        visible={volumeModalVisible}
        onClose={() => setVolumeModalVisible(false)}
        palette={palette}
        title={volumeModel.title || "播放音量"}
        subtitle={volumeModel.meta || undefined}
        icon={volumeModel.muted ? VolumeX : Volume2}
        closeLabel="关闭音量设置"
        scroll={false}
      >
            <View style={styles.optionGrid}>
              {volumeModel.options.map((option: any) => {
                const active = option.active;
                return (
                  <Touchable
                    key={option.value}
                    style={[
                      styles.chipOption,
                      {
                        backgroundColor: active
                          ? withAlpha(palette.primaryInk, 0.12)
                          : palette.surfaceMuted,
                        borderColor: active ? palette.primaryInk : "transparent",
                      },
                    ]}
                    onPress={() => {
                      hapticLight();
                      handleSetVolume(option.value);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`音量 ${option.label}`}
                  >
                    <Text
                      style={[
                        styles.chipOptionText,
                        {
                          color: active ? palette.primaryInk : palette.text,
                          fontWeight: active ? "700" : "500",
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Touchable>
                );
              })}
            </View>

            <Touchable
              style={[
                styles.muteActionBtn,
                {
                  backgroundColor: volumeModel.muted
                    ? palette.danger
                    : withAlpha(palette.primaryInk, 0.1),
                  borderColor: volumeModel.muted ? palette.danger : palette.border,
                },
              ]}
              onPress={() => {
                hapticLight();
                handleToggleMute();
              }}
              accessibilityRole="button"
              accessibilityLabel={volumeModel.muteLabel}
            >
              {volumeModel.muted ? (
                <VolumeX size={18} color={palette.surface} />
              ) : (
                <Volume2 size={18} color={palette.primaryInk} />
              )}
              <Text
                style={[
                  styles.muteActionText,
                  { color: volumeModel.muted ? palette.surface : palette.primaryInk },
                ]}
              >
                {volumeModel.muteLabel}
              </Text>
            </Touchable>
      </SheetFrame>

      {/* ── 3. 睡眠定时抽屉 (Bottom Sheet) ── */}
      <SheetFrame
        visible={sleepModalVisible}
        onClose={() => setSleepModalVisible(false)}
        palette={palette}
        title="睡眠定时"
        subtitle="到达设定时间或歌曲播完后自动停止播放"
        icon={Clock}
        closeLabel="关闭睡眠定时"
        maxHeightRatio={0.85}
        keyboard
        scroll={false}
      >
              <ScrollView
                style={styles.sleepScrollArea}
                contentContainerStyle={styles.sleepScrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* 当前定时状态指示卡片 */}
                <View
                  style={[
                    styles.statusCard,
                    {
                      backgroundColor:
                        sleepTimerActive || sleepTimerSongActive
                          ? withAlpha(palette.primaryInk, 0.08)
                          : palette.surfaceMuted,
                      borderColor:
                        sleepTimerActive || sleepTimerSongActive
                          ? withAlpha(palette.primaryInk, 0.2)
                          : "transparent",
                    },
                  ]}
                >
                  <View style={styles.statusInfo}>
                    <Text
                      style={[
                        styles.statusTitle,
                        {
                          color:
                            sleepTimerActive || sleepTimerSongActive
                              ? palette.primaryInk
                              : palette.textMuted,
                        },
                      ]}
                    >
                      {sleepTimerActive && sleepTimerMinutes != null
                        ? `正在倒计时 · 剩余 ${sleepTimerMinutes} 分钟`
                        : sleepTimerSongActive
                        ? `正在倒计时 · 剩余 ${sleepTimerSongCount} 首歌曲`
                        : "睡眠定时器未开启"}
                    </Text>
                    <Text style={[styles.statusSubtitle, { color: palette.textSubtle }]}>
                      {sleepTimerActive || sleepTimerSongActive
                        ? "到期后将平滑暂停音频播放"
                        : "选择下方预设或输入自定义数值快速开启"}
                    </Text>
                  </View>

                  {sleepTimerActive || sleepTimerSongActive ? (
                    <Touchable
                      style={[
                        styles.cancelTimerBtn,
                        { backgroundColor: withAlpha(palette.danger, 0.1) },
                      ]}
                      onPress={() => {
                        hapticLight();
                        handleCancelSleepTimer();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="关闭当前定时器"
                    >
                      <Text style={[styles.cancelTimerText, { color: palette.danger }]}>
                        取消定时
                      </Text>
                    </Touchable>
                  ) : null}
                </View>

                {/* 选项组 1：按时间停止 */}
                <View style={styles.sectionHeader}>
                  <Clock size={15} color={palette.primaryInk} />
                  <Text style={[styles.sectionTitle, { color: palette.text }]}>按时间停止</Text>
                </View>
                <View style={styles.optionGrid}>
                  {sleepTimerControl.minutePresets.map((minutes: any) => {
                    const active = sleepTimerActive && sleepTimerMinutes === minutes;
                    return (
                      <Touchable
                        key={minutes}
                        onPress={() => {
                          hapticLight();
                          handleStartSleepTimer(minutes);
                          setSleepModalVisible(false);
                        }}
                        style={[
                          styles.chipOption,
                          {
                            backgroundColor: active
                              ? palette.actionFill
                              : palette.surfaceMuted,
                            borderColor: active ? palette.actionFill : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipOptionText,
                            {
                              color: active ? palette.onActionFill : palette.text,
                              fontWeight: active ? "700" : "500",
                            },
                          ]}
                        >
                          {minutes} 分钟
                        </Text>
                      </Touchable>
                    );
                  })}
                </View>

                {/* 自定义分钟输入 */}
                <View style={[styles.customRow, { backgroundColor: palette.surfaceMuted }]}>
                  <TextInput
                    style={[styles.customInput, { color: palette.text }]}
                    placeholder="输入自定义分钟数"
                    placeholderTextColor={palette.textMuted}
                    keyboardType="numeric"
                    value={String(customMinutes ?? "")}
                    onChangeText={setCustomMinutes}
                  />
                  <Touchable
                    style={[
                      styles.customStartBtn,
                      {
                        backgroundColor: customMinutesValid ? palette.actionFill : palette.border,
                      },
                    ]}
                    onPress={() => {
                      hapticLight();
                      handleStartCustomSleepTimer();
                      setSleepModalVisible(false);
                    }}
                    disabled={!customMinutesValid}
                  >
                    <Text
                      style={[
                        styles.customStartText,
                        { color: customMinutesValid ? palette.onActionFill : palette.textMuted },
                      ]}
                    >
                      开启
                    </Text>
                  </Touchable>
                </View>

                {/* 选项组 2：按歌曲数停止 */}
                <View style={[styles.sectionHeader, { marginTop: spacing.l }]}>
                  <Music2 size={15} color={palette.primaryInk} />
                  <Text style={[styles.sectionTitle, { color: palette.text }]}>
                    听完歌曲后停止
                  </Text>
                </View>
                <View style={styles.optionGrid}>
                  {sleepTimerControl.songCountPresets.map((songCount: any) => {
                    const active = sleepTimerSongActive && sleepTimerSongCount === songCount;
                    return (
                      <Touchable
                        key={songCount}
                        onPress={() => {
                          hapticLight();
                          handleStartSongSleepTimer(songCount);
                          setSleepModalVisible(false);
                        }}
                        style={[
                          styles.chipOption,
                          {
                            backgroundColor: active
                              ? palette.actionFill
                              : palette.surfaceMuted,
                            borderColor: active ? palette.actionFill : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipOptionText,
                            {
                              color: active ? palette.onActionFill : palette.text,
                              fontWeight: active ? "700" : "500",
                            },
                          ]}
                        >
                          {songCount} 首
                        </Text>
                      </Touchable>
                    );
                  })}
                </View>

                {/* 自定义歌曲数输入 */}
                <View style={[styles.customRow, { backgroundColor: palette.surfaceMuted }]}>
                  <TextInput
                    style={[styles.customInput, { color: palette.text }]}
                    placeholder="输入自定义歌曲数"
                    placeholderTextColor={palette.textMuted}
                    keyboardType="numeric"
                    value={String(customSongCount ?? "")}
                    onChangeText={setCustomSongCount}
                  />
                  <Touchable
                    style={[
                      styles.customStartBtn,
                      {
                        backgroundColor: customSongCountValid ? palette.actionFill : palette.border,
                      },
                    ]}
                    onPress={() => {
                      hapticLight();
                      handleStartCustomSongSleepTimer();
                      setSleepModalVisible(false);
                    }}
                    disabled={!customSongCountValid}
                  >
                    <Text
                      style={[
                        styles.customStartText,
                        { color: customSongCountValid ? palette.onActionFill : palette.textMuted },
                      ]}
                    >
                      开启
                    </Text>
                  </Touchable>
                </View>
              </ScrollView>
      </SheetFrame>

      {/* ── 4. 播放队列抽屉 ── */}
      <QueueModal
        visible={queueModalVisible}
        queueModel={queueModel}
        queue={queue}
        palette={palette}
        onClose={() => setQueueModalVisible(false)}
        onPlayItem={(index) => void handlePlayQueueItem(index)}
        onRemoveItem={handleRemoveQueueItem}
        onClear={() => void handleClearQueue()}
        onRequestNavigate={onQueueNavigate}
      />
    </>
  );
}

const styles = StyleSheet.create({
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    gap: spacing.s,
  },
  chipOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72,
    height: 42,
    paddingHorizontal: spacing.m,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 4,
  },
  chipOptionText: {
    fontSize: typography.body,
  },
  chipCheck: {
    marginLeft: 2,
  },
  muteActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 46,
    marginHorizontal: spacing.l,
    marginBottom: spacing.s,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
  },
  muteActionText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  sleepScrollArea: {
    flexGrow: 0,
    flexShrink: 1,
  },
  sleepScrollContent: {
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.m,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.m,
    gap: spacing.s,
  },
  statusInfo: {
    flex: 1,
    gap: 3,
  },
  statusTitle: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  statusSubtitle: {
    fontSize: typography.caption,
  },
  cancelTimerBtn: {
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  cancelTimerText: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    padding: 4,
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  customInput: {
    flex: 1,
    height: 38,
    paddingHorizontal: spacing.m,
    fontSize: typography.body,
  },
  customStartBtn: {
    paddingHorizontal: spacing.l,
    height: 38,
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  customStartText: {
    fontSize: typography.body,
    fontWeight: "600",
  },
});
