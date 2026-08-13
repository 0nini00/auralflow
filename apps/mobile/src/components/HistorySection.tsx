import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MusicInfo } from "@lx/core";

import { SongList } from "@/components/SongList";
import { groupHistoryEntries, type HistoryEntry } from "@/services/historyGroupModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing, typography } from "@/theme/tokens";

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
 * 播放历史分组列表（对齐 lx「分时间记录」）：
 * 今天 / 昨天 / M月D日 / YYYY年M月D日 分组头 + 组内歌曲列表。
 */
export function HistorySection({
  entries,
  onPlay,
  onDelete,
  emptyText = "播放歌曲后会自动按时间记录到这里",
  hideSourceTag,
}: HistorySectionProps) {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(mode, systemTheme), accentColor);

  const groups = groupHistoryEntries(entries);
  if (groups.length === 0) {
    // 空态无可播放歌曲，SongList 的 onPlay 仅用于空态占位。
    return <SongList songs={[]} onPlay={() => undefined} emptyText={emptyText} hideSourceTag={hideSourceTag} />;
  }

  return (
    <View style={styles.root}>
      {groups.map((group) => {
        const songs = group.entries.map((entry) => entry.song);
        return (
          <View key={group.title} style={styles.group}>
            <Text style={[styles.groupTitle, { color: palette.textMuted }]}>
              {group.title}
            </Text>
            <SongList
              songs={songs}
              onPlay={(_song, index) => onPlay(songs, index)}
              onDelete={onDelete}
              hideSourceTag={hideSourceTag}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.s,
  },
  group: {
    gap: spacing.xxs,
  },
  groupTitle: {
    fontSize: typography.meta,
    fontWeight: "700",
    paddingVertical: spacing.xs,
  },
});
