import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MusicInfo } from "@lx/core";

import { CachedImage } from "@/components/CachedImage";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { SongList } from "@/components/SongList";
import { LoginScreen } from "@/screens/LoginScreen";
import { useAccountStore } from "@/stores/accountStore";
import {
  getDailyRecommendSongs,
  type DailyRecommendResult,
} from "@/services/wyPlaylistService";
import { playQueue, playShuffledQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { buildScreenTheme } from "@/services/screenThemeModel";
import { buildDailyRecommendMeta } from "@/services/dailyRecommendMetaModel";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, touch, typography } from "@/theme/tokens";

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
  const screenTheme = buildScreenTheme(palette);
  const dailyMeta = buildDailyRecommendMeta();

  const [songs, setSongs] = useState<MusicInfo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
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
    onNavigateToPlayer();
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
          <Text style={[styles.backText, { color: screenTheme.primaryBackground }]}>返回</Text>
        </Pressable>

        <View style={styles.header}>
        {dailyCoverUrl ? (
          <CachedImage
            uri={dailyCoverUrl}
            style={styles.cover}
            fallback={
              <View
                style={[styles.cover, styles.coverFallback, { backgroundColor: screenTheme.cardBackground }]}
              >
                <Text style={[styles.coverFallbackText, { color: screenTheme.primaryBackground }]}>推荐</Text>
              </View>
            }
          />
        ) : (
          <View style={[styles.cover, styles.coverFallback, { backgroundColor: screenTheme.cardBackground }]}>
            <Text style={[styles.coverFallbackText, { color: screenTheme.primaryBackground }]}>推荐</Text>
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: screenTheme.titleText }]}>{dailyMeta.title}</Text>
          <Text style={[styles.subtitle, { color: screenTheme.bodyText }]}>{isLoggedIn ? dailyMeta.subtitle : "登录网易云后查看今日推荐。"}</Text>
        </View>
        </View>

        {isLoggedIn && songs.length > 0 && (
          <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="播放全部每日推荐"
            style={[styles.actionButton, { backgroundColor: screenTheme.primaryBackground, borderColor: screenTheme.primaryBackground }]}
            onPress={handlePlayAll}
          >
            <Text style={[styles.primaryActionText, { color: screenTheme.primaryText }]}>播放全部</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="随机播放每日推荐"
            style={[styles.actionButton, { backgroundColor: screenTheme.cardBackground, borderColor: screenTheme.cardBorder }]}
            onPress={handleShufflePlay}
          >
            <Text style={[styles.actionText, { color: screenTheme.titleText }]}>随机播放</Text>
          </Pressable>
          </View>
        )}

        {isLoggedIn && (
          <SectionHeader
            title="歌曲列表"
            description={`${songs.length} 首${hasMore ? "，还有更多" : ""}`}
            action={(
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="刷新每日推荐"
                onPress={handleRefresh}
                disabled={loading || refreshing}
                style={[styles.refreshButton, { backgroundColor: screenTheme.cardBackground, borderColor: screenTheme.cardBorder }]}
              >
                {refreshing ? (
                  <ActivityIndicator color={screenTheme.primaryBackground} size="small" />
                ) : (
                  <Text style={[styles.refreshText, { color: screenTheme.primaryBackground }]}>刷新</Text>
                )}
              </Pressable>
            )}
            style={styles.listHeader}
          />
        )}

        {!isLoggedIn && !loading && (
          <View style={styles.stateWithAction}>
            <EmptyState
              title="未登录网易云账号"
              description="当前页面需要登录态才能拉取每日推荐。"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="登录网易云账号"
              style={[styles.primaryButton, { backgroundColor: screenTheme.primaryBackground }]}
              onPress={() => setShowLoginModal(true)}
            >
              <Text style={[styles.primaryButtonText, { color: screenTheme.primaryText }]}>登录账号</Text>
            </Pressable>
          </View>
        )}

        <Modal
        visible={showLoginModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowLoginModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: screenTheme.strongBackground }]}>
          <View style={styles.modalHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭登录窗口"
              style={styles.modalCloseButton}
              onPress={() => setShowLoginModal(false)}
            >
              <Text style={[styles.modalClose, { color: screenTheme.titleText }]}>关闭</Text>
            </Pressable>
          </View>
          <LoginScreen onSuccess={() => setShowLoginModal(false)} />
        </View>
        </Modal>

        {loading && <LoadingState label="正在加载每日推荐" />}

        {!!error && !loading && <ErrorState message={error} onRetry={() => void handleRefresh()} />}

        {!loading && isLoggedIn && !error && songs.length === 0 && (
          <EmptyState title="今天还没有推荐歌曲" description="稍后刷新再试。" />
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
    gap: 16,
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
    marginBottom: 20,
    gap: 14,
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
    gap: 12,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  actionText: {
    fontSize: typography.body,
    color: palette.text,
    fontWeight: "600",
  },
  primaryActionText: {
    fontSize: typography.body,
    color: palette.primaryText,
    fontWeight: "700",
  },
  listHeader: {
    marginTop: 4,
  },
  refreshButton: {
    marginLeft: "auto",
    minWidth: 68,
    minHeight: touch.minTarget,
    paddingHorizontal: 16,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshText: {
    fontSize: typography.meta,
    fontWeight: "600",
    color: palette.primary,
  },
  section: {
    marginBottom: 20,
  },
  stateWithAction: {
    gap: 8,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primary,
    paddingHorizontal: 20,
    alignSelf: "stretch",
    marginTop: 8,
  },
  primaryButtonText: {
    fontSize: typography.body,
    fontWeight: "700",
    color: palette.primaryText,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: palette.background,
  },
  modalHeader: {
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  modalCloseButton: {
    minHeight: touch.minTarget,
    minWidth: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  modalClose: {
    fontSize: typography.body,
    fontWeight: "600",
    color: palette.text,
  },
  });
}
