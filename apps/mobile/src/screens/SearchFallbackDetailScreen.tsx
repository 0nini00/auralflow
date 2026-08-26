import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MusicInfo } from "@lx/core";

import { ActionButton } from "@/components/ActionButton";
import { SongList } from "@/components/SongList";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SectionHeader } from "@/components/SectionHeader";
import type { SearchFallbackDetailModel } from "@/services/searchFallbackDetailModel";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { spacing, typography } from "@/theme/tokens";

interface SearchFallbackDetailScreenProps {
  detail: SearchFallbackDetailModel;
  onBack: () => void;
  onNavigateToPlayer: () => void;
}

/**
 * 非网易云歌手/专辑的降级详情：没有官方详情接口时，用搜索结果里的相关歌曲顶上。 */
export function SearchFallbackDetailScreen({
  detail,
  onNavigateToPlayer,
}: SearchFallbackDetailScreenProps) {
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const [playbackError, setPlaybackError] = React.useState<string | null>(null);

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  };

  const handlePlay = async (_song: MusicInfo, index: number) => {
    if (detail.songs.length === 0) return;
    await runPlayback(() => playQueue(detail.songs, index));
  };

  const handlePlayAll = async () => {
    if (detail.songs.length === 0) return;
    await runPlayback(() => playQueue(detail.songs, 0));
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView>
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />
        <View style={styles.header}>
          <SectionHeader title={detail.title} description={detail.subtitle} />
          <Text style={[styles.hint, { color: palette.textMuted }]}>
            该音源暂无完整详情页，已根据当前搜索结果整理出可播放歌曲。
          </Text>
        </View>

        {detail.songs.length > 0 && (
          <ActionButton
            variant="primary"
            label="播放全部"
            count={`(${detail.songs.length})`}
            style={styles.playAllButton}
            onPress={() => {
              void handlePlayAll();
            }}
          />
        )}

        <View style={styles.section}>
          <SectionHeader title="相关歌曲" description={`${detail.songs.length} 首`} />
          {detail.songs.length > 0 ? (
            <SongList
              songs={detail.songs}
              onPlay={handlePlay}
              emptyText={detail.emptyHint || "暂无相关歌曲"}
              hideSourceTag
            />
          ) : (
            <EmptyState title={detail.emptyHint || "暂无相关歌曲"} />
          )}
        </View>
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
    marginBottom: spacing.m,
  },
  hint: {
    fontSize: typography.meta,
    lineHeight: 18,
  },
  playAllButton: {
    marginBottom: spacing.m,
  },
  section: {
    gap: spacing.s,
  },
});
