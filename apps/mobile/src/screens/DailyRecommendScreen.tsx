import React, { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MusicInfo } from "@lx/core";

import { CachedImage } from "@/components/CachedImage";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { CalendarDays } from "lucide-react-native";

import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SongList } from "@/components/SongList";
import { useAccountStore } from "@/stores/accountStore";
import {
  getDailyRecommendSongs,
  type DailyRecommendResult,
} from "@/services/wyPlaylistService";
import { playQueue, playShuffledQueue } from "@/services/playerService";
import { ActionButton } from "@/components/ActionButton";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { buildDailyRecommendMeta } from "@/services/dailyRecommendMetaModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, touch, typography } from "@/theme/tokens";

interface DailyRecommendScreenProps {
  onNavigateToPlayer: () => void;
  onBack: () => void;
}

export function DailyRecommendScreen({
  onNavigateToPlayer,
  onBack,
}: DailyRecommendScreenProps) {
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const checkStatus = useAccountStore((state) => state.checkStatus);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const styles = makeStyles(palette);
  const dailyMeta = buildDailyRecommendMeta();

  const [songs, setSongs] = useState<MusicInfo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const dailyCoverUrl = songs[0]?.img || songs[0]?.picUrl;

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    let mounted = true;

    const load = async (isRefresh = false) => {
      if (!isLoggedIn) {
        if (mounted) {
          setSongs([]);
          setHasMore(false);
          setError(null);
          setLoading(false);
          setRefreshing(false);
        }
        return;
      }

      if (mounted) {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);
      }

      try {
        const result: DailyRecommendResult = await getDailyRecommendSongs();
        if (mounted) {
          setSongs(result.songs);
          setHasMore(result.hasMore);
        }
      } catch (err) {
        if (mounted) {
          setSongs([]);
          setHasMore(false);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (mounted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [isLoggedIn]);

  const handleRefresh = async () => {
    if (!isLoggedIn) return;

    setRefreshing(true);
    setError(null);
    try {
      const result = await getDailyRecommendSongs();
      setSongs(result.songs);
      setHasMore(result.hasMore);
    } catch (err) {
      setSongs([]);
      setHasMore(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const runPlayback = async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) {
      setPlaybackError(result.message);
      return;
    }
  };

  const handlePlay = async (_song: MusicInfo, index: number) => {
    await runPlayback(() => playQueue(songs, index));
  };

  const handlePlayAll = async () => {
    if (songs.length === 0) return;
    await runPlayback(() => playQueue(songs, 0));
  };

  const handleShufflePlay = async () => {
    if (songs.length === 0) return;
    await runPlayback(() => playShuffledQueue(songs));
  };

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.container}>
        <PlaybackErrorState
          message={playbackError}
          onDismiss={() => setPlaybackError(null)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          style={styles.backButton}
          onPress={onBack}
        >
          <Text style={[styles.backText, { color: palette.primary }]}>返回</Text>
        </Pressable>

        <View style={styles.header}>
        {dailyCoverUrl ? (
          <CachedImage
            uri={dailyCoverUrl}
            style={styles.cover}
            fallback={
              <View
                style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surface }]}
              >
                <Text style={[styles.coverFallbackText, { color: palette.primary }]}>推荐</Text>
              </View>
            }
          />
        ) : (
          <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surface }]}>
            <Text style={[styles.coverFallbackText, { color: palette.primary }]}>推荐</Text>
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: palette.text }]}>{dailyMeta.title}</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>{isLoggedIn ? dailyMeta.subtitle : "登录网易云后查看今日推荐。"}</Text>
        </View>
        </View>

        {isLoggedIn && songs.length > 0 && (
          <View style={styles.actions}>
          <ActionButton
            shrink
            small
            variant="primary"
            accessibilityLabel="播放全部每日推荐"
            onPress={handlePlayAll}
            label="播放全部"
          />
          <ActionButton
            shrink
            small
            accessibilityLabel="随机播放每日推荐"
            onPress={handleShufflePlay}
            label="随机播放"
          />
          </View>
        )}

        {isLoggedIn && (
          <SectionHeader
            title="歌曲列表"
            description={`${songs.length} 首${hasMore ? "，还有更多" : ""}`}
            action={(
              <ActionButton
                small
                accessibilityLabel="刷新每日推荐"
                onPress={handleRefresh}
                loading={refreshing}
                disabled={loading}
                label="刷新"
              />
            )}
            style={styles.listHeader}
          />
        )}

        {!isLoggedIn && !loading && (
          <View style={styles.stateWithAction}>
            <EmptyState
              title="未登录网易云账号"
              description="请在 设置 → 账号与服务 登录网易云账号后查看每日推荐。"
            />
          </View>
        )}


        {loading && <LoadingState label="正在加载每日推荐" />}

        {!!error && !loading && <ErrorState message={error} onRetry={() => void handleRefresh()} />}

        {!loading && isLoggedIn && !error && songs.length === 0 && (
          <EmptyState icon={CalendarDays} title="今天还没有推荐歌曲" description="稍后刷新再试。" />
        )}

        {!loading && isLoggedIn && songs.length > 0 && (
          <View style={styles.section}>
            <SongList songs={songs} onPlay={handlePlay} emptyText="今日推荐为空" />
          </View>
        )}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

function makeStyles(palette: ReturnType<typeof getThemePalette>) {
  return StyleSheet.create({
  container: {
    gap: spacing.l,
  },
  backButton: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: typography.title,
    color: palette.primary,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.l,
    gap: spacing.s,
  },
  cover: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
  },
  coverFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  coverFallbackText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  headerText: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontSize: typography.display,
    fontWeight: "700",
    color: palette.text,
  },
  subtitle: {
    fontSize: typography.body,
    lineHeight: 20,
    color: palette.textMuted,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.m,
  },
  listHeader: {
    marginTop: 4,
  },
  section: {
    marginBottom: spacing.l,
  },
  stateWithAction: {
    gap: 8,
  },
  });
}
