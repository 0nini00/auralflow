import React from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";

import {
  canDrawOverlays,
  getLyricOverlayStyle,
  hideLyricOverlay,
  isLyricOverlaySupported,
  requestOverlayPermission,
  setLyricOverlayLocked,
  setLyricOverlayStyle,
  showLyricOverlay,
  type LyricOverlayStyle,
} from "@/services/lyricOverlayService";
import { useLyricOverlayStore } from "@/stores/lyricOverlayStore";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { ChoiceChip } from "@/components/ChoiceChip";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing, typography } from "@/theme/tokens";

/** 字号档位（sp）。原生侧会夹取到 10-40。 */
const FONT_SIZE_OPTIONS = [
  { label: "小", value: 16 },
  { label: "中", value: 18 },
  { label: "大", value: 22 },
  { label: "超大", value: 26 },
];

const OPACITY_OPTIONS = [
  { label: "60%", value: 60 },
  { label: "80%", value: 80 },
  { label: "100%", value: 100 },
];

const DEFAULT_STYLE: Required<LyricOverlayStyle> = {
  fontSize: 18,
  textOpacity: 100,
  showNextLine: true,
  shadowEnabled: true,
  activeColor: "",
  inactiveColor: "",
  fontFamily: "",
};

/**
 * 悬浮歌词设置：收敛为「开关」「样式」两张分组卡片，
 * 行内条目用 hairline 分隔，终结此前 7 张零散卡片的碎片化排版。
 */
export function LyricOverlaySettings() {
  const visible = useLyricOverlayStore((state) => state.visible);
  const locked = useLyricOverlayStore((state) => state.locked);
  const notificationButtonEnabled = useLyricOverlayStore((state) => state.notificationButtonEnabled);
  const notificationButtonUpdating = useLyricOverlayStore(
    (state) => state.notificationButtonUpdating,
  );
  const loaded = useLyricOverlayStore((state) => state.loaded);
  const overlayError = useLyricOverlayStore((state) => state.error);
  const setVisible = useLyricOverlayStore((state) => state.setVisible);
  const setNotificationButtonEnabled = useLyricOverlayStore(
    (state) => state.setNotificationButtonEnabled,
  );
  const setLocked = useLyricOverlayStore((state) => state.setLocked);
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);
  const supported = isLyricOverlaySupported();

  // 外观以原生 Preferences 为唯一真相，进页面时读回一次作为初值
  const [style, setStyleState] = React.useState<Required<LyricOverlayStyle>>(DEFAULT_STYLE);
  React.useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void getLyricOverlayStyle()
      .then((value) => {
        if (!cancelled) setStyleState({ ...DEFAULT_STYLE, ...value });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const patchStyle = async (patch: LyricOverlayStyle) => {
    const previous = style;
    setStyleState({ ...style, ...patch });
    try {
      await setLyricOverlayStyle(patch);
    } catch (error) {
      setStyleState(previous);
      Alert.alert("悬浮歌词样式设置失败", error instanceof Error ? error.message : String(error));
    }
  };

  const toggleVisible = async () => {
    try {
      if (visible) {
        await hideLyricOverlay();
        await setVisible(false);
        return;
      }
      if (!isLyricOverlaySupported()) throw new Error("当前设备不支持原生悬浮歌词");
      let granted = await canDrawOverlays();
      if (!granted) granted = await requestOverlayPermission();
      if (!granted) throw new Error("请在系统设置中允许应用显示在其他应用上层");
      if (!await showLyricOverlay()) throw new Error("原生悬浮歌词窗口未能打开");
      await setVisible(true);
    } catch (error) {
      Alert.alert("悬浮歌词操作失败", error instanceof Error ? error.message : String(error));
    }
  };

  const toggleLocked = async () => {
    try {
      const next = !locked;
      await setLyricOverlayLocked(next);
      await setLocked(next);
    } catch (error) {
      Alert.alert("悬浮歌词锁定失败", error instanceof Error ? error.message : String(error));
    }
  };

  const toggleNotificationButton = async (enabled: boolean) => {
    try {
      await setNotificationButtonEnabled(enabled);
    } catch (error) {
      Alert.alert("通知歌词按钮设置失败", error instanceof Error ? error.message : String(error));
    }
  };

  const notificationSubtitle = !supported
    ? "当前设备不支持播放通知显示歌词按钮"
    : !loaded
      ? "正在加载设置"
      : overlayError ?? "在 Android 播放通知中切换悬浮歌词";

  return (
    <>
      <SettingsCard style={styles.groupCard}>
        <SwitchRow
          palette={palette}
          title="悬浮歌词"
          subtitle={`${visible ? "已显示" : "未显示"}，在其他应用上层展示当前歌词`}
          value={visible}
          onValueChange={() => void toggleVisible()}
          accessibilityLabel="悬浮歌词开关"
        />
        <Hairline palette={palette} />
        <SwitchRow
          palette={palette}
          title="锁定悬浮歌词位置"
          subtitle={locked ? "已锁定，位置不可拖动" : "未锁定，可拖动调整位置"}
          value={locked}
          onValueChange={() => void toggleLocked()}
          accessibilityLabel="锁定悬浮歌词位置"
        />
        <Hairline palette={palette} />
        <SwitchRow
          palette={palette}
          title="播放通知显示歌词按钮"
          subtitle={notificationSubtitle}
          value={notificationButtonEnabled}
          disabled={!loaded || notificationButtonUpdating || !supported}
          onValueChange={(enabled) => void toggleNotificationButton(enabled)}
          accessibilityLabel="播放通知显示歌词按钮"
        />
      </SettingsCard>

      <SettingsCard style={styles.groupCard}>
        <View style={styles.stackGroup}>
          <Text style={[styles.rowTitle, { color: palette.text }]}>歌词字号</Text>
          <Text style={[styles.rowSubtitle, { color: palette.textMuted }]}>下一行会自动小一档</Text>
          <View style={styles.chipRow}>
            {FONT_SIZE_OPTIONS.map((option) => (
              <ChoiceChip
                key={option.value}
                label={option.label}
                selected={style.fontSize === option.value}
                disabled={!supported}
                onPress={() => void patchStyle({ fontSize: option.value })}
                accessibilityLabel={`歌词字号 ${option.label}`}
              />
            ))}
          </View>
        </View>
        <Hairline palette={palette} />
        <View style={styles.stackGroup}>
          <Text style={[styles.rowTitle, { color: palette.text }]}>文字不透明度</Text>
          <View style={styles.chipRow}>
            {OPACITY_OPTIONS.map((option) => (
              <ChoiceChip
                key={option.value}
                label={option.label}
                selected={style.textOpacity === option.value}
                disabled={!supported}
                onPress={() => void patchStyle({ textOpacity: option.value })}
                accessibilityLabel={`文字不透明度 ${option.label}`}
              />
            ))}
          </View>
        </View>
        <Hairline palette={palette} />
        <SwitchRow
          palette={palette}
          title="显示下一行歌词"
          subtitle={style.showNextLine ? "显示两行" : "只显示当前行"}
          value={style.showNextLine}
          disabled={!supported}
          onValueChange={(value) => void patchStyle({ showNextLine: value })}
          accessibilityLabel="显示下一行歌词"
        />
        <Hairline palette={palette} />
        <SwitchRow
          palette={palette}
          title="文字投影"
          subtitle="关闭后在浅色壁纸上可能看不清"
          value={style.shadowEnabled}
          disabled={!supported}
          onValueChange={(value) => void patchStyle({ shadowEnabled: value })}
          accessibilityLabel="文字投影"
        />
      </SettingsCard>
    </>
  );
}

function Hairline({ palette }: { palette: ReturnType<typeof getThemePalette> }) {
  return <View style={[styles.hairline, { backgroundColor: palette.border }]} />;
}

interface SwitchRowProps {
  palette: ReturnType<typeof getThemePalette>;
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}

function SwitchRow({
  palette,
  title,
  subtitle,
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
}: SwitchRowProps) {
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
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: palette.surfaceMuted, true: palette.primary }}
        thumbColor={value ? palette.primaryText : palette.textMuted}
      />
    </View>
  );
}

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
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  rowTitle: { fontSize: typography.body, fontWeight: "600" },
  rowSubtitle: { fontSize: typography.caption },
});
