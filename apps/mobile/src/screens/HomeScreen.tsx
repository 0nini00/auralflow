import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { MusicInfo } from "@lx/core";
import { CalendarDays, Clock3, LayoutGrid, Radio, Search, Trophy } from "lucide-react-native";
import { AlbumRail, HomeQuickActions, HomeSectionError, PlaylistRail } from "@/components/HomeFeedSections";
import { ActionButton } from "@/components/ActionButton";
import { PlaybackErrorState } from "@/components/PlaybackErrorState";
import { ScreenScaffold, ScreenScrollView } from "@/components/ScreenScaffold";
import { SectionHeader } from "@/components/SectionHeader";
import { SongList } from "@/components/SongList";
import { openDailyRecommendScreen, openLeaderboardScreen, openPlaylistDetailScreen, openPlaylistSquareScreen } from "@/navigation/navigationRef";
import { getHomeFeedScope } from "@/services/homeFeedModels";
import type { HomeFeedSection, HomeFeedSectionId } from "@/services/homeFeedService";
import { fetchWyLeaderboardBoards } from "@/services/wyLeaderboardService";
import { getPlaylistDetail } from "@/services/wyPlaylistService";
import { playQueue } from "@/services/playerService";
import { runPlaybackUiAction } from "@/services/playbackUiAction";
import { useAccountStore } from "@/stores/accountStore";
import { useHomeFeedStore } from "@/stores/homeFeedStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { radius, spacing, typography } from "@/theme/tokens";

interface HomeScreenProps {
  onNavigateToSearch: () => void;
  onNavigateToFm: () => void;
  onNavigateToHistory: () => void;
}

const SONG_PREVIEW_LIMIT = 5;

export function HomeScreen({ onNavigateToSearch, onNavigateToFm, onNavigateToHistory }: HomeScreenProps) {
  const isLoggedIn = useAccountStore((state) => state.isLoggedIn);
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
  const quickActions = [
    { id: "search", label: "搜索", icon: <Search size={18} color={palette.background} /> },
    { id: "history", label: "播放历史", icon: <Clock3 size={18} color={palette.background} /> },
    { id: "daily", label: "每日推荐", icon: <CalendarDays size={18} color={palette.background} /> },
    { id: "fm", label: "私人 FM", icon: <Radio size={18} color={palette.background} /> },
    { id: "leaderboard", label: "排行榜", icon: <Trophy size={18} color={palette.background} /> },
    { id: "square", label: "歌单广场", icon: <LayoutGrid size={18} color={palette.background} /> },
  ];
  const handleQuickAction = (id: string) => {
    if (id === "search") { onNavigateToSearch(); return; }
    if (id === "history") { onNavigateToHistory(); return; }
    if (id === "fm") { onNavigateToFm(); return; }
    if (id === "daily") { openDailyRecommendScreen(); return; }
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

function createStyles(palette: ReturnType<typeof getThemePalette>) {
  return StyleSheet.create({
    container: { gap: spacing.l }, section: { minWidth: 0, gap: spacing.s }, loadingPlaceholder: { minHeight: 112, alignItems: "center", justifyContent: "center", gap: spacing.xs }, loadingText: { color: palette.textMuted, fontSize: typography.meta },
  });
}
