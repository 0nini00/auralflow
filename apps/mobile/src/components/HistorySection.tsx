import React, { useState } from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import type { MusicInfo } from "@lx/core";
import { ChevronLeft, ChevronRight } from "lucide-react-native";

import { SongList } from "@/components/SongList";
import {
  DAY_MS,
  addDays,
  dayStartOf,
  filterEntriesByDay,
  formatHistoryDayTitle,
  type HistoryEntry,
} from "@/services/historyGroupModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing, touch, typography } from "@/theme/tokens";

interface HistorySectionProps {
  /** 分时间记录的条目（按播放时间倒序）。 */
  entries: HistoryEntry[];
  /** 播放一组歌曲：songs 为组内列表，index 为组内序号。 */
  onPlay: (songs: MusicInfo[], index: number) => void;
  onDelete?: (song: MusicInfo) => void;
  emptyText?: string;
  hideSourceTag?: boolean;
}

/**
 * 播放历史（单日视图）：
 * 一次只展示某一天的历史，顶部 ‹ 日期 › 前后调节；
 * 空日期保留导航，可继续翻到有记录的日子。
 */
export function HistorySection({
  entries,
  onPlay,
  onDelete,
  emptyText = "当天没有播放记录",
  hideSourceTag,
}: HistorySectionProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const [selectedDay, setSelectedDay] = useState(() => dayStartOf(Date.now()));

  const dayEntries = filterEntriesByDay(entries, selectedDay);
  const songs = dayEntries.map((entry) => entry.song);
  const handlePlay = (_song: MusicInfo, index: number) => {
    onPlay(songs, index);
  };

  const canGoNext = selectedDay < dayStartOf(Date.now());
  const goPrev = () => setSelectedDay((day) => addDays(day, -1));
  const goNext = () => {
    if (canGoNext) setSelectedDay((day) => addDays(day, 1));
  };

  return (
    <View style={styles.root}>
      <View style={styles.navigationRow}>
        <Pressable
          onPress={goPrev}
          accessibilityLabel="前一天"
          style={({ pressed }) => [
            styles.navButton,
            { borderColor: palette.border },
            pressed && styles.navButtonPressed,
          ]}
        >
          <ChevronLeft size={22} color={palette.text} />
        </Pressable>

        <Text style={[styles.dayTitle, { color: palette.text }]} numberOfLines={1}>
          {formatHistoryDayTitle(selectedDay)}
        </Text>

        <Pressable
          onPress={goNext}
          accessibilityLabel="后一天"
          accessibilityState={{ disabled: !canGoNext }}
          disabled={!canGoNext}
          style={({ pressed }) => [
            styles.navButton,
            { borderColor: palette.border },
            !canGoNext && styles.navButtonDisabled,
            pressed && canGoNext && styles.navButtonPressed,
          ]}
        >
          <ChevronRight size={22} color={palette.text} />
        </Pressable>
      </View>

      <SongList
        songs={songs}
        onPlay={songs.length > 0 ? handlePlay : () => undefined}
        onDelete={onDelete}
        emptyText={emptyText}
        hideSourceTag={hideSourceTag}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.s,
  },
  navigationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  navButton: {
    width: touch.minTarget,
    height: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: touch.minTarget / 2,
  },
  navButtonPressed: {
    opacity: 0.7,
  },
  navButtonDisabled: {
    opacity: 0.35,
  },
  dayTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: typography.body,
    fontWeight: "700",
  },
});
