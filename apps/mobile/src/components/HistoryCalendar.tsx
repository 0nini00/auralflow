import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight, X } from "lucide-react-native";

import { addMonths, getHistoryCalendarDays, type HistoryEntry } from "@/services/historyGroupModel";
import type { ThemePalette } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

interface HistoryCalendarProps {
  entries: HistoryEntry[];
  selectedDay: number;
  palette: ThemePalette;
  onSelect: (dayStart: number) => void;
  onClose: () => void;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const MAX_CALENDAR_WIDTH = 380;

/** 由宿主按需挂载，每次打开都回到当前所选日期的月份。 */
export function HistoryCalendar({ entries, selectedDay, palette, onSelect, onClose }: HistoryCalendarProps) {
  const [month, setMonth] = useState(() => addMonths(selectedDay, 0));
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const now = Date.now();
  const days = getHistoryCalendarDays(entries, month, selectedDay, now);
  const monthDate = new Date(month);
  const canGoNext = month < addMonths(now, 0);
  const panelWidth = Math.min(width - insets.left - insets.right - spacing.xxs * 2, MAX_CALENDAR_WIDTH);
  // 大字体保留数字和触控宽度，溢出时横向滚动，而不是缩小字号。
  const cellWidth = Math.max(
    (panelWidth - StyleSheet.hairlineWidth * 2) / WEEKDAYS.length,
    touch.minTarget,
    Math.ceil(typography.body * fontScale * 2 + spacing.xs),
  );

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View
        style={[
          styles.overlay,
          {
            paddingTop: insets.top + spacing.s,
            paddingBottom: insets.bottom + spacing.s,
            paddingLeft: insets.left + spacing.xxs,
            paddingRight: insets.right + spacing.xxs,
          },
        ]}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="遮罩关闭历史日历"
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.panel,
            {
              width: panelWidth,
              maxHeight: height - insets.top - insets.bottom - spacing.s * 2,
              backgroundColor: palette.surface,
              borderColor: palette.border,
            },
          ]}
        >
          <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
            <View style={styles.header}>
              <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>播放历史</Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="关闭历史日历"
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <X size={20} color={palette.textMuted} />
              </Pressable>
            </View>
            <View style={styles.monthRow}>
              <Pressable
                onPress={() => setMonth((value) => addMonths(value, -1))}
                accessibilityRole="button"
                accessibilityLabel="上个月"
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <ChevronLeft size={22} color={palette.text} />
              </Pressable>
              <Text accessibilityLiveRegion="polite" style={[styles.monthTitle, { color: palette.text }]}>
                {monthDate.getFullYear()}年{monthDate.getMonth() + 1}月
              </Text>
              <Pressable
                onPress={canGoNext ? () => setMonth((value) => addMonths(value, 1)) : undefined}
                disabled={!canGoNext}
                accessibilityRole="button"
                accessibilityLabel="下个月"
                accessibilityState={{ disabled: !canGoNext }}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <ChevronRight size={22} color={canGoNext ? palette.text : palette.textSubtle} />
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ width: cellWidth * WEEKDAYS.length }}>
                <View style={styles.weekRow}>
                  {WEEKDAYS.map((day) => (
                    <Text key={day} style={[styles.weekday, { width: cellWidth, color: palette.textMuted }]}>{day}</Text>
                  ))}
                </View>
                <View style={styles.grid}>
                  {days.map((cell, index) => {
                    if (!cell) return <View key={`empty-${index}`} style={{ width: cellWidth }} />;
                    const date = new Date(cell.dayStart);
                    return (
                      <Pressable
                        key={cell.dayStart}
                        disabled={cell.disabled}
                        onPress={cell.disabled ? undefined : () => {
                          onSelect(cell.dayStart);
                          onClose();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`}
                        accessibilityHint={cell.disabled ? "无可选播放记录" : "查看当天播放历史"}
                        accessibilityState={{ disabled: cell.disabled, selected: cell.selected }}
                        style={({ pressed }) => [styles.dayCell, { width: cellWidth }, pressed && styles.pressed]}
                      >
                        <View
                          style={[
                            styles.dayIndicator,
                            cell.selected && {
                              backgroundColor: palette.surfaceStrong,
                              borderColor: cell.disabled ? palette.border : palette.text,
                            },
                          ]}
                        >
                          <Text style={[styles.dayText, { color: cell.disabled ? palette.textSubtle : palette.text }]}>
                            {date.getDate()}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </ScrollView>
            <Text style={[styles.hint, { color: palette.textMuted }]}>仅有真实播放记录的日期可选</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  panel: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingBottom: spacing.s },
  header: { flexDirection: "row", alignItems: "center", paddingLeft: spacing.m, paddingRight: spacing.xxs },
  title: { flex: 1, fontSize: typography.title, fontWeight: "700" },
  iconButton: { width: touch.minTarget, height: touch.minTarget, alignItems: "center", justifyContent: "center" },
  monthRow: { flexDirection: "row", alignItems: "center" },
  monthTitle: { flex: 1, textAlign: "center", fontSize: typography.body, fontWeight: "700" },
  weekRow: { flexDirection: "row", paddingVertical: spacing.xs },
  weekday: { textAlign: "center", fontSize: typography.caption },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { minHeight: touch.minTarget, alignItems: "center", justifyContent: "center", paddingVertical: spacing.xxs },
  dayIndicator: { minWidth: touch.iconButton, minHeight: touch.iconButton, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: "transparent", paddingHorizontal: spacing.xxs },
  dayText: { fontSize: typography.body, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  hint: { textAlign: "center", fontSize: typography.caption, paddingHorizontal: spacing.s, marginTop: spacing.xs },
});
