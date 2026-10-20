import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getCloudSongs } from "@/services/wyCloudService";
import { useAccountStore } from "@/stores/accountStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { layout, radius, spacing, typography } from "@/theme/tokens";

interface CloudDriveScreenProps {
  onNavigateToPlayer: () => void;
}

/** 每页条数，与桌面端 `stores/cloudDriveStore` 保持一致。 */
const PAGE_SIZE = 50;

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
 * 云盘是账号私有资源：未登录不渲染内容，也不请求接口——`getCloudSongs` 在没有
 * Cookie 时直接抛错。
 *
 * 列表来自 weapi `/v1/cloud/get`，**不是搜索结果**：只有被网易云匹配到在线曲目的
 * 上传才会被 `cloudsearch` 命中，仅自己可见的条目搜不到。所以这里是「浏览云盘」。
 */
export function CloudDriveScreen({ onNavigateToPlayer: _onNavigateToPlayer }: CloudDriveScreenProps) {
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const checkStatus = useAccountStore((state) => state.checkStatus);

  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor),
    [themeMode, systemTheme, accentColor],
  );
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const [songs, setSongs] = useState<MusicInfo[]>([]);
  const [count, setCount] = useState(0);
  const [usedBytes, setUsedBytes] = useState<number | undefined>(undefined);
  const [maxBytes, setMaxBytes] = useState<number | undefined>(undefined);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  /** 并发闸门：翻页与刷新互斥，避免同一 offset 被拉两次导致列表重复 */
  const inflightRef = useRef(false);
  /**
   * 请求世代：账号变化（含退出登录）时递增，晚到的响应一律丢弃。
   * 不加这个的话，切账号时旧账号在飞的请求会把别人的列表写回来。
   */
  const requestGenRef = useRef(0);

  const coverUrl = songs[0]?.picUrl || songs[0]?.img;

  const loadFirstPage = useCallback(async (isRefresh = false) => {
    const gen = requestGenRef.current;
    if (inflightRef.current) return;
    inflightRef.current = true;
    if (mountedRef.current) {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
    }
    try {
      const page = await getCloudSongs({ offset: 0, limit: PAGE_SIZE });
      if (!mountedRef.current || gen !== requestGenRef.current) return;
      setSongs(page.songs);
      setCount(page.count);
      setUsedBytes(page.usedBytes);
      setMaxBytes(page.maxBytes);
      setNextOffset(page.nextOffset);
      setHasMore(page.hasMore);
    } catch (err) {
      if (!mountedRef.current || gen !== requestGenRef.current) return;
      // 刷新失败不要毁掉已加载的列表：网络抖一下就把 50 条清空，空状态还会显示
      // 「云盘里没有歌曲」，属于误导。只有首屏（还没有数据）才清空。
      if (!isRefresh) {
        setSongs([]);
        setCount(0);
        setNextOffset(0);
        setHasMore(false);
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === requestGenRef.current) {
        inflightRef.current = false;
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
  }, []);

  // 账号变化必须重载：checkStatus 只在挂载时跑一次，切账号后页面还留在栈里时会
  // 沿用上一个账号的列表。accountKey 同时承担「退出登录清空」的职责。
  const accountKey = useAccountStore((state) => state.user?.userId ?? "");
  useEffect(() => {
    mountedRef.current = true;
    requestGenRef.current += 1; // 作废上一个账号在飞的请求
    inflightRef.current = false;
    void (async () => {
      await checkStatus();
      if (!mountedRef.current) return;
      if (!useAccountStore.getState().isLoggedIn) {
        setSongs([]);
        setCount(0);
        setNextOffset(0);
        setHasMore(false);
        setError(null);
        setLoading(false);
        return;
      }
      await loadFirstPage();
    })();
    return () => {
      mountedRef.current = false;
    };
  }, [checkStatus, loadFirstPage, accountKey]);

  const handleLoadMore = useCallback(async () => {
    if (inflightRef.current || loading || loadingMore || !hasMore) return;
    const gen = requestGenRef.current;
    inflightRef.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await getCloudSongs({ offset: nextOffset, limit: PAGE_SIZE });
      if (!mountedRef.current || gen !== requestGenRef.current) return;
      setSongs((prev) => [...prev, ...page.songs]);
      setCount(page.count);
      setUsedBytes(page.usedBytes);
      setMaxBytes(page.maxBytes);
      setNextOffset(page.nextOffset);
      setHasMore(page.hasMore);
    } catch (err) {
      if (!mountedRef.current || gen !== requestGenRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === requestGenRef.current) {
        inflightRef.current = false;
        if (mountedRef.current) setLoadingMore(false);
      }
    }
  }, [hasMore, loading, loadingMore, nextOffset]);

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
                <Cloud size={28} color={palette.primary} strokeWidth={1.8} />
              </View>
            }
          />
        ) : (
          <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.surface }]}>
            <Cloud size={28} color={palette.primary} strokeWidth={1.8} />
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
              onPress={() => void loadFirstPage(true)}
              loading={refreshing}
              disabled={loading}
              label="刷新"
            />
          }
          style={styles.listHeader}
        />
      )}

      {!isLoggedIn && !loading && (
        <EmptyState
          title="未登录网易云账号"
          description="音乐云盘里的文件只对你自己可见，请在「设置 → 账号与服务」登录后查看。"
        />
      )}

      {loading && <LoadingState label="正在读取云盘" />}

      {!!error && !loading && (
        <ErrorState message={error} onRetry={() => void loadFirstPage(true)} />
      )}
    </>
  );

  const listFooter =
    !loading && isLoggedIn && !error && songs.length === 0 ? (
      <EmptyState
        icon={Cloud}
        title="云盘里没有歌曲"
        description="在网易云音乐客户端里把本地文件「上传到音乐云盘」之后会出现在这里。"
      />
    ) : isLoggedIn && hasMore && !loading ? (
      <View style={styles.loadMore}>
        <ActionButton
          small
          accessibilityLabel="加载更多云盘歌曲"
          onPress={() => void handleLoadMore()}
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
        onEndReached={() => void handleLoadMore()}
        refreshControl={
          isLoggedIn ? (
            <RefreshControl
              refreshing={refreshing}
              tintColor={palette.primary}
              colors={[palette.primary]}
              onRefresh={() => void loadFirstPage(true)}
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
