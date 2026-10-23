import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { Cloud } from "lucide-react-native";
import { cloudQualityLabel, type MusicInfo } from "@lx/core";

import { ActionButton } from "@/components/ActionButton";
import { CachedImage } from "@/components/CachedImage";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState, ErrorState, LoadingState } from "@/components/ScreenState";
import { SectionHeader } from "@/components/SectionHeader";
import { SongList } from "@/components/SongList";
import { playQueue, playShuffledQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { useAccountStore } from "@/stores/accountStore";
import { useCloudDriveStore } from "@/stores/cloudDriveStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { layout, radius, spacing, typography } from "@/theme/tokens";

interface CloudDriveScreenProps {
  onNavigateToPlayer: () => void;
}

/** 容量展示：1024 进制，GB 以上保留一位小数，否则退到 MB。 */
function formatBytes(bytes?: number): string | undefined {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

/**
 * 音乐云盘（对齐桌面端 `/cloud`）。
 *
 * 列表与「是否还有下一页」都在 `stores/cloudDriveStore` 里，进页面不再必然重新请求：
 * 同一账号加载过就直接复用，只有换账号或用户点「刷新」/ 下拉刷新才重拉。
 *
 * 账号状态仍要确认一次：`accountStore` 的登录态没有全局启动引导，冷启动直接进云盘时
 * 它还是 `false`。所以这里只在「看起来未登录」时问一次 `checkStatus()`；已登录的会话里
 * 进页面是零额外请求。
 */
export function CloudDriveScreen({ onNavigateToPlayer: _onNavigateToPlayer }: CloudDriveScreenProps) {
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const userId = useAccountStore((state) => state.user?.userId ?? "");
  const checkStatus = useAccountStore((state) => state.checkStatus);

  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor),
    [themeMode, systemTheme, accentColor],
  );
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const songs = useCloudDriveStore((state) => state.songs);
  const count = useCloudDriveStore((state) => state.count);
  const usedBytes = useCloudDriveStore((state) => state.usedBytes);
  const maxBytes = useCloudDriveStore((state) => state.maxBytes);
  const hasMore = useCloudDriveStore((state) => state.hasMore);
  const loading = useCloudDriveStore((state) => state.loading);
  const loadingMore = useCloudDriveStore((state) => state.loadingMore);
  const error = useCloudDriveStore((state) => state.error);
  const loaded = useCloudDriveStore((state) => state.loaded);
  const initialize = useCloudDriveStore((state) => state.initialize);
  const loadMore = useCloudDriveStore((state) => state.loadMore);
  const refresh = useCloudDriveStore((state) => state.refresh);

  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // 账号变化（含退出登录）才重新判定归属：store 自己按 uid 决定复用还是重拉。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!useAccountStore.getState().isLoggedIn) {
        // 登录态未知：问一次；已登录时这条不会发（见组件注释）。
        await checkStatus().catch(() => undefined);
        if (cancelled) return;
      }
      const state = useAccountStore.getState();
      await initialize(state.isLoggedIn ? state.user?.userId ?? "" : "");
    })();
    return () => { cancelled = true; };
  }, [initialize, checkStatus, userId, isLoggedIn]);

  const coverUrl = songs[0]?.picUrl || songs[0]?.img;
  // 刷新时列表还在，用下拉指示器而不是把整页换成「正在读取云盘」。
  const refreshing = loading && songs.length > 0;
  const showLoading = loading || (isLoggedIn && !loaded);

  const runPlayback = useCallback(async (action: () => Promise<void>) => {
    setPlaybackError(null);
    const result = await runPlaybackUiAction(action);
    if (!result.ok) setPlaybackError(result.message);
  }, []);

  const handlePlay = useCallback(
    async (_song: MusicInfo, index: number) => {
      await runPlayback(() => playQueue(songs, index));
    },
    [runPlayback, songs],
  );

  const handlePlayAll = useCallback(() => {
    if (songs.length === 0) return;
    void runPlayback(() => playQueue(songs, 0));
  }, [runPlayback, songs]);

  const handleShufflePlay = useCallback(() => {
    if (songs.length === 0) return;
    void runPlayback(() => playShuffledQueue(songs));
  }, [runPlayback, songs]);

  const handleLoadMore = useCallback(() => {
    void loadMore();
  }, [loadMore]);

  // 云盘不做转码，所以这里显示的是上传文件的真实码率，而不是用户选的音质档位。
  const getExtraMetadata = useCallback((song: MusicInfo) => {
    return cloudQualityLabel(song.cloudMeta?.bitrate);
  }, []);

  const capacityText = useMemo(() => {
    const used = formatBytes(usedBytes);
    const max = formatBytes(maxBytes);
    if (!used && !max) return undefined;
    return `已用 ${used ?? "—"} / ${max ?? "—"}`;
  }, [usedBytes, maxBytes]);

  // 头部内容随列表滚动：SongList 的 virtualized 路径把 FlatList 本体当作滚动容器
  // （见 SongList 顶部注释）。再套一层 ScreenScrollView 会让内层列表拿不到滚动，
  // 触底加载永远不触发，表现就是「只能看到首屏那一批」。
  const listHeader = (
    <>
      <PlaybackErrorState message={playbackError} onDismiss={() => setPlaybackError(null)} />

      <View style={styles.header}>
        {coverUrl ? (
          <CachedImage
            uri={coverUrl}
            style={styles.cover}
            fallback={
              <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surface }]}>
                <Cloud size={28} color={palette.primaryInk} strokeWidth={1.8} />
              </View>
            }
          />
        ) : (
          <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surface }]}>
            <Cloud size={28} color={palette.primaryInk} strokeWidth={1.8} />
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: palette.text }]}>音乐云盘</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {isLoggedIn
              ? `${count} 首${capacityText ? ` · ${capacityText}` : ""}`
              : "登录网易云账号后查看你上传到云盘的文件。"}
          </Text>
        </View>
      </View>

      {isLoggedIn && songs.length > 0 && (
        <View style={styles.actions}>
          <ActionButton
            shrink
            small
            variant="primary"
            accessibilityLabel="播放全部云盘歌曲"
            onPress={handlePlayAll}
            label="播放全部"
          />
          <ActionButton
            shrink
            small
            accessibilityLabel="随机播放云盘歌曲"
            onPress={handleShufflePlay}
            label="随机播放"
          />
        </View>
      )}

      {isLoggedIn && (
        <SectionHeader
          title="歌曲列表"
          description={`${songs.length} 首${hasMore ? `，还有 ${Math.max(count - songs.length, 0)} 首未加载` : ""}`}
          action={
            <ActionButton
              small
              accessibilityLabel="刷新云盘列表"
              onPress={() => void refresh()}
              loading={refreshing}
              disabled={loading}
              label="刷新"
            />
          }
          style={styles.listHeader}
        />
      )}

      {!isLoggedIn && !showLoading && (
        <EmptyState
          title="未登录网易云账号"
          description="音乐云盘里的文件只对你自己可见，请在「设置 → 账号与服务」登录后查看。"
        />
      )}

      {showLoading && <LoadingState label="正在读取云盘" />}

      {!!error && !showLoading && (
        <ErrorState message={error} onRetry={() => void refresh()} />
      )}
    </>
  );

  const listFooter =
    !showLoading && isLoggedIn && !error && songs.length === 0 ? (
      <EmptyState
        icon={Cloud}
        title="云盘里没有歌曲"
        description="在网易云音乐客户端里把本地文件「上传到音乐云盘」之后会出现在这里。"
      />
    ) : isLoggedIn && hasMore && !showLoading ? (
      <View style={styles.loadMore}>
        <ActionButton
          small
          accessibilityLabel="加载更多云盘歌曲"
          onPress={handleLoadMore}
          loading={loadingMore}
          disabled={loadingMore}
          label="加载更多"
        />
      </View>
    ) : null;

  return (
    <ScreenScaffold>
      <SongList
        virtualized
        songs={songs}
        onPlay={handlePlay}
        emptyText="云盘为空"
        hideSourceTag
        getExtraMetadata={getExtraMetadata}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        onEndReached={handleLoadMore}
        refreshControl={
          isLoggedIn ? (
            <RefreshControl
              refreshing={refreshing}
              tintColor={palette.primary}
              colors={[palette.primary]}
              onRefresh={() => void refresh()}
            />
          ) : undefined
        }
        contentContainerStyle={styles.listContent}
      />
    </ScreenScaffold>
  );
}

function makeStyles(palette: ReturnType<typeof getThemePalette>) {
  return StyleSheet.create({
    // SongList 的 virtualized 路径自己就是滚动容器，页面内边距从这里给
    // （与 LikedSongsScreen / PlaylistDetailScreen 的 listContent 一致）。
    listContent: {
      paddingHorizontal: layout.pagePadding,
      paddingTop: spacing.xs,
      paddingBottom: spacing.l,
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
    loadMore: {
      alignItems: "center",
      paddingBottom: spacing.l,
    },
  });
}
