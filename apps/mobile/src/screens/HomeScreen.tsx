import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { MusicInfo } from "@lx/core";
import { CalendarDays, Download, Folder, LayoutGrid, Music2, Pause, Play, Radio, Trophy, User } from "lucide-react-native";
import { AlbumRail, HomeQuickActions, HomeSectionError, PlaylistRail } from "@/components/HomeFeedSections";
import { ActionButton } from "@/components/ActionButton";
import { CachedImage } from "@/components/CachedImage";
import { LargeHeader } from "@/components/LargeHeader";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { SongList } from "@/components/SongList";
import { Touchable } from "@/components/Touchable";
import { openDailyRecommendScreen, openDownloadsScreen, openLeaderboardScreen, openLibrarySection, openPlaylistDetailScreen, openPlaylistSquareScreen, openMyMusicTab, openPlayerScreen } from "@/navigation/navigationRef";
import { getHomeFeedScope } from "@/services/homeFeedModels";
import type { HomeFeedSection, HomeFeedSectionId } from "@/services/homeFeedService";
import { fetchWyLeaderboardBoards } from "@/services/wyLeaderboardService";
import { getPlaylistDetail } from "@/services/wyPlaylistService";
import { playFromQueue, playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { selectPlaybackArtwork } from "@/services/localMediaPlaybackModel";
import { useAccountStore } from "@/stores/accountStore";
import { useHomeFeedStore } from "@/stores/homeFeedStore";
import { usePlayerStore } from "@/stores/playerStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface HomeScreenProps {
  onNavigateToSearch: () => void;
  onNavigateToFm: () => void;
  onNavigateToHistory: () => void;
}

const SONG_PREVIEW_LIMIT = 5;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatHomeEyebrow(date: Date): string {
  return `${WEEKDAYS[date.getDay()]} · ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function getGreeting(hour: number): string {
  if (hour < 5) return "凌晨好";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function formatClock(seconds: number): string {
  // playerStore 的 position/duration 来自 RNTP 的 PlaybackProgressUpdated，单位是秒
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function HomeScreen({ onNavigateToSearch: _onNavigateToSearch, onNavigateToFm, onNavigateToHistory: _onNavigateToHistory }: HomeScreenProps) {
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
  const user = useAccountStore((state) => state.user);
  const userId = useAccountStore((state) => state.user?.userId ?? null);
  const sections = useHomeFeedStore((state) => state.sections);
  const loaded = useHomeFeedStore((state) => state.loaded);
  const refreshing = useHomeFeedStore((state) => state.refreshing);
  const sectionLoading = useHomeFeedStore((state) => state.sectionLoading);
  const load = useHomeFeedStore((state) => state.load);
  const refreshAll = useHomeFeedStore((state) => state.refreshAll);
  const refreshSection = useHomeFeedStore((state) => state.refreshSection);
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const context = useMemo(() => ({ scopeKey: getHomeFeedScope(userId), isLoggedIn, userId }), [isLoggedIn, userId]);

  useEffect(() => { void load(context); }, [context, load]);

  const recommendedPlaylists = sections.find((section) => section.kind === "recommendedPlaylists");
  const dailySongs = sections.find((section) => section.kind === "dailySongs");
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [leaderboardSongs, setLeaderboardSongs] = useState<MusicInfo[]>([]);

  // 首页排行榜区块：展示首个官方榜的下方歌曲（横排 10 首），失败静默隐藏。
  const refreshLeaderboards = useCallback(() => {
    void fetchWyLeaderboardBoards()
      .then(async (list) => {
        const first = list.find((board) => board.group === "official");
        if (!first) {
          setLeaderboardSongs([]);
          return;
        }
        try {
          const songs = await getPlaylistDetail(first.id);
          setLeaderboardSongs(songs.slice(0, 10));
        } catch {
          setLeaderboardSongs([]);
        }
      })
      .catch(() => setLeaderboardSongs([]));
  }, []);

  useEffect(() => {
    refreshLeaderboards();
  }, [refreshLeaderboards]);

  const runPlayback = async (songs: MusicInfo[], index: number) => {
    if (songs.length === 0) return;
    setPlaybackError(null);
    const result = await runPlaybackUiAction(() => playQueue(songs, index));
    if (!result.ok) { setPlaybackError(result.message); return; }
  };
  // 登录时四个发现入口；未登录时前两格换成不依赖账号的「本地音乐 / 下载」，
  // 保持 4 格布局不塌陷，也不对未登录用户做「登录后可用」的宣传。
  const quickActionIconColor = palette.text;
  const quickActions = isLoggedIn
    ? [
        { id: "daily", label: "每日推荐", icon: <CalendarDays size={20} color={quickActionIconColor} /> },
        { id: "fm", label: "私人 FM", icon: <Radio size={20} color={quickActionIconColor} /> },
        { id: "leaderboard", label: "排行榜", icon: <Trophy size={20} color={quickActionIconColor} /> },
        { id: "square", label: "歌单广场", icon: <LayoutGrid size={20} color={quickActionIconColor} /> },
      ]
    : [
        { id: "local", label: "本地音乐", icon: <Folder size={20} color={quickActionIconColor} /> },
        { id: "downloads", label: "下载", icon: <Download size={20} color={quickActionIconColor} /> },
        { id: "leaderboard", label: "排行榜", icon: <Trophy size={20} color={quickActionIconColor} /> },
        { id: "square", label: "歌单广场", icon: <LayoutGrid size={20} color={quickActionIconColor} /> },
      ];
  const handleQuickAction = (id: string) => {
    if (id === "fm") { onNavigateToFm(); return; }
    if (id === "daily") { openDailyRecommendScreen(); return; }
    if (id === "local") { openLibrarySection("local"); return; }
    if (id === "downloads") { openDownloadsScreen(); return; }
    if (id === "leaderboard") { openLeaderboardScreen(); return; }
    if (id === "square") { openPlaylistSquareScreen(); return; }
  };
  const handleRefresh = async () => {
    await refreshAll(context, { force: true });
    refreshLeaderboards();
  };
  const renderLoading = (label: string) => <View accessibilityLiveRegion="polite" style={styles.loadingPlaceholder}><ActivityIndicator size="small" color={palette.primary} /><Text style={styles.loadingText}>{label}</Text></View>;
  const renderSectionError = (section: HomeFeedSection | undefined, id: HomeFeedSectionId) => section?.status === "error" ? <HomeSectionError message={section.error?.message ?? "加载失败"} loading={sectionLoading[id]} onRetry={() => void refreshSection(id, context)} /> : null;

  return (
    <ScreenScaffold>
      <ScreenScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} tintColor={palette.primary} colors={[palette.primary]} onRefresh={() => void handleRefresh()} />}>
        <LargeHeader
          eyebrow={formatHomeEyebrow(new Date())}
          title={getGreeting(new Date().getHours())}
          style={styles.header}
          right={(
            <Touchable
              onPress={openMyMusicTab}
              activeScale={0.94}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="打开我的"
              style={[styles.avatar, { backgroundColor: palette.surfaceStrong }]}
            >
              {user?.avatarUrl ? (
                <CachedImage
                  uri={user.avatarUrl}
                  style={styles.avatarImage}
                  fallback={(
                    <View style={styles.avatarFallback}>
                      <User size={18} color={palette.primaryInk} />
                    </View>
                  )}
                />
              ) : (
                <View style={styles.avatarFallback}>
                  {user?.nickname ? (
                    <Text style={[styles.avatarText, { color: palette.primaryInk }]}>
                      {user.nickname.slice(0, 1)}
                    </Text>
                  ) : (
                    <User size={18} color={palette.primaryInk} />
                  )}
                </View>
              )}
            </Touchable>
          )}
        />
        <ContinueListeningCard
          palette={palette}
          styles={styles}
          onOpen={openPlayerScreen}
          onError={setPlaybackError}
        />
        <PlaybackErrorState message={playbackError} onDismiss={() => setPlaybackError(null)} />
        <View style={styles.section}>
          <SectionHeader title="快捷入口" />
          <HomeQuickActions actions={quickActions} onPress={handleQuickAction} />
        </View>
        <View style={styles.section}><SectionHeader title="推荐歌单" action={<SectionAction label="更多" onPress={openPlaylistSquareScreen} />} />{!recommendedPlaylists && (!loaded || refreshing) ? renderLoading("正在加载推荐歌单") : null}{recommendedPlaylists?.items?.length ? <PlaylistRail items={recommendedPlaylists.items.map((playlist) => ({ id: playlist.id, name: playlist.name, coverImgUrl: playlist.coverImgUrl }))} onPress={(id) => { const playlist = recommendedPlaylists.items.find((item) => item.id === id); if (playlist) openPlaylistDetailScreen(playlist); }} /> : null}{renderSectionError(recommendedPlaylists, "recommendedPlaylists")}</View>
        <View style={styles.section}><SectionHeader title="排行榜" action={<SectionAction label="更多" onPress={openLeaderboardScreen} />} />{leaderboardSongs.length > 0 ? <AlbumRail items={leaderboardSongs.map((song) => ({ id: song.id, name: song.name, artistName: song.singer, coverImgUrl: song.picUrl || song.img }))} onPress={(id) => { const index = leaderboardSongs.findIndex((song) => song.id === id); if (index >= 0) void runPlayback(leaderboardSongs, index); }} /> : null}</View>
        {isLoggedIn ? <View style={styles.section}><SectionHeader title="每日推荐" action={<SectionAction label="查看全部" onPress={openDailyRecommendScreen} />} />{!dailySongs && (!loaded || refreshing || sectionLoading.dailySongs) ? renderLoading("正在加载每日推荐") : null}{dailySongs?.items?.length ? <SongList songs={dailySongs.items.slice(0, SONG_PREVIEW_LIMIT)} hideSourceTag onPlay={(_song, index) => void runPlayback(dailySongs.items, index)} /> : null}{renderSectionError(dailySongs, "dailySongs")}</View> : null}
      </ScreenScrollView>
    </ScreenScaffold>
  );
}

function SectionAction({ label, onPress }: { label: string; onPress: () => void }) {
  return <ActionButton label={label} variant="secondary" small onPress={onPress} accessibilityLabel={label} />;
}

/**
 * 继续收听卡：第一屏先回答「听什么」。
 *
 * 进度与播放状态订阅隔离在这个子组件里：0.25s 的进度 tick 只重渲染这张卡，
 * 不会带着首页的 rail / 列表一起重建。
 */
function ContinueListeningCard({
  palette,
  styles,
  onOpen,
  onError,
}: {
  palette: ReturnType<typeof getThemePalette>;
  styles: ReturnType<typeof createStyles>;
  onOpen: () => void;
  onError: (message: string) => void;
}) {
  const currentSong = usePlayerStore((state) => state.currentSong);
  const coverUrl = usePlayerStore(selectPlaybackArtwork);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const position = usePlayerStore((state) => state.position);
  const duration = usePlayerStore((state) => state.duration);
  const pause = usePlayerStore((state) => state.pause);
  const resume = usePlayerStore((state) => state.resume);

  if (!currentSong) return null;

  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const singer = currentSong.singer?.trim() || "未知歌手";

  const handleToggle = async () => {
    try {
      if (isPlaying) {
        await pause();
        return;
      }
      await resume();
      const state = usePlayerStore.getState();
      if (!state.isPlaying && state.currentIndex >= 0) {
        // 快照恢复后原生无曲：重新播放当前曲并续播上次保存的进度
        await playFromQueue(state.currentIndex, state.position);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Touchable
      onPress={onOpen}
      activeScale={0.99}
      accessibilityRole="button"
      accessibilityLabel={`继续收听 ${currentSong.name}`}
      style={[styles.continueCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      {coverUrl ? (
        <CachedImage
          uri={coverUrl}
          style={styles.continueCover}
          fallback={(
            <View style={[styles.continueCover, styles.continueCoverFallback, { backgroundColor: palette.surfaceStrong }]}>
              <Music2 size={20} color={palette.textSubtle} />
            </View>
          )}
        />
      ) : (
        <View style={[styles.continueCover, styles.continueCoverFallback, { backgroundColor: palette.surfaceStrong }]}>
          <Music2 size={20} color={palette.textSubtle} />
        </View>
      )}
      <View style={styles.continueBody}>
        <Text style={[styles.continueLabel, { color: palette.textMuted }]}>继续收听</Text>
        <Text style={[styles.continueTitle, { color: palette.text }]} numberOfLines={1}>
          {currentSong.name}
        </Text>
        <Text style={[styles.continueMeta, { color: palette.textMuted }]} numberOfLines={1}>
          {`${singer} · ${formatClock(position)} / ${formatClock(duration)}`}
        </Text>
        <View style={[styles.continueBar, { backgroundColor: palette.surfaceStrong }]}>
          <View style={[styles.continueBarFill, { width: `${progress * 100}%`, backgroundColor: palette.primary }]} />
        </View>
      </View>
      <Touchable
        onPress={() => void handleToggle()}
        activeScale={0.94}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? "暂停" : "继续播放"}
        style={[styles.continuePlay, { backgroundColor: palette.primary }]}
      >
        {isPlaying ? (
          <Pause size={17} color={palette.primaryText} fill={palette.primaryText} />
        ) : (
          <Play size={17} color={palette.primaryText} fill={palette.primaryText} />
        )}
      </Touchable>
    </Touchable>
  );
}

function createStyles(palette: ReturnType<typeof getThemePalette>) {
  return StyleSheet.create({
    container: { gap: spacing.l },
    header: { paddingHorizontal: 0, paddingBottom: spacing.xs },
    avatar: { width: 40, height: 40, borderRadius: 20, overflow: "hidden" },
    avatarImage: { width: 40, height: 40 },
    avatarFallback: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    avatarText: { fontSize: 15, fontWeight: "700" },
    continueCard: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.s,
      padding: spacing.s,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      shadowColor: "#101614",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.08,
      shadowRadius: 14,
      elevation: 3,
    },
    continueCover: { width: 56, height: 56, borderRadius: radius.lg },
    continueCoverFallback: { alignItems: "center", justifyContent: "center" },
    continueBody: { flex: 1, minWidth: 0 },
    continueLabel: { fontSize: 10, lineHeight: 13, fontWeight: "700", letterSpacing: 0.8 },
    continueTitle: { marginTop: 2, fontSize: 15, lineHeight: 20, fontWeight: "700", letterSpacing: -0.2 },
    continueMeta: { marginTop: 1, fontSize: typography.micro, lineHeight: 14 },
    continueBar: { marginTop: 6, height: 2, borderRadius: 2, overflow: "hidden" },
    continueBarFill: { height: "100%", borderRadius: 2 },
    continuePlay: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    section: { minWidth: 0, gap: spacing.s }, loadingPlaceholder: { minHeight: 112, alignItems: "center", justifyContent: "center", gap: spacing.xs }, loadingText: { color: palette.textMuted, fontSize: typography.meta },
  });
}
