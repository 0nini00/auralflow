import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MusicInfo } from "@lx/core";
import { Heart, Play, Shuffle } from "lucide-react-native";

import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/IconButton";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SongList } from "@/components/SongList";
import { EmptyState } from "@/components/ScreenState";
import { openLikedSongsScreen } from "@/navigation/navigationRef";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { shufflePlaylistSongs } from "@/services/playlistDetailActions";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

const PREVIEW_LIMIT = 5;

/**
 * 音乐库 · 收藏段。
 *
 * 不重复实现一套长列表：这里只给「我喜欢」的摘要卡 + 前 5 首预览，
 * 「查看全部」进入原有的虚拟化 LikedSongsScreen，几千首也不掉帧。
 */
export function FavoritesSection() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  const favorites = useFavoritesStore((state) => state.favorites);
  const loadFavorites = useFavoritesStore((state) => state.loadFromStorage);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const runPlayback = useCallback(async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) setPlaybackError(result.message);
  }, []);

  const handlePlay = useCallback(
    (_song: MusicInfo, index: number) => {
      void runPlayback(() => playQueue(favorites, index));
    },
    [favorites, runPlayback],
  );

  const handlePlayAll = () => {
    if (favorites.length === 0) return;
    void runPlayback(() => playQueue(favorites, 0));
  };

  const handleShuffle = () => {
    if (favorites.length === 0) return;
    void runPlayback(() => playQueue(shufflePlaylistSongs(favorites), 0));
  };

  if (favorites.length === 0) {
    return (
      <EmptyState
        icon={Heart}
        title="还没有喜欢的歌曲"
        description="在歌曲列表或播放页点击喜欢按钮，喜欢的歌都会收在这里。"
      />
    );
  }

  return (
    <View>
      <PlaybackErrorState message={playbackError} onDismiss={() => setPlaybackError(null)} />

      <View style={[styles.hero, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.heroTop}>
          <View style={[styles.heartCircle, { backgroundColor: palette.surfaceMuted }]}>
            <Heart size={24} color={palette.primaryInk} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={[styles.heroTitle, { color: palette.text }]}>我喜欢的音乐</Text>
            <Text style={[styles.heroMeta, { color: palette.textMuted }]}>
              {`${favorites.length} 首歌曲 · 本地收藏`}
            </Text>
          </View>
        </View>

        <View style={styles.heroActions}>
          <Button
            label="播放全部"
            variant="brand"
            size="medium"
            leading={<Play size={16} color={palette.onActionFill} fill={palette.onActionFill} />}
            onPress={handlePlayAll}
            style={styles.playAll}
          />
          <IconButton
            size="sm"
            tone="strong"
            onPress={handleShuffle}
            accessibilityLabel="随机播放"
            render={({ size, color }) => <Shuffle size={size} color={color} />}
            style={[styles.shuffle, { borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          <View style={styles.viewAll}>
            <Button
              label="查看全部"
              variant="ghost"
              size="medium"
              onPress={openLikedSongsScreen}
            />
          </View>
        </View>
      </View>

      <View style={styles.preview}>
        <Text style={[styles.previewTitle, { color: palette.textMuted }]}>最近收藏</Text>
        <SongList
          songs={favorites.slice(0, PREVIEW_LIMIT)}
          onPlay={handlePlay}
          hideSourceTag={false}
          showLikeAction
          showMoreAction={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    padding: spacing.m,
    gap: spacing.m,
    shadowColor: "#101614",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
  },
  heartCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
  },
  heroTitle: {
    fontSize: typography.title,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  heroMeta: {
    marginTop: 3,
    fontSize: typography.meta,
  },
  heroActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  playAll: {
    flex: 1,
  },
  shuffle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
  },
  viewAll: {
    flexShrink: 0,
  },
  preview: {
    marginTop: spacing.xl,
  },
  previewTitle: {
    marginBottom: spacing.xs,
    fontSize: typography.micro,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
});
