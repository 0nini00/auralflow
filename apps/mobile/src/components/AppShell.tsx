import React, { useCallback, useEffect, useMemo, useState } from "react";
import { type NavigationState } from "@react-navigation/native";
import { BackHandler, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { BackgroundPlaybackGuard } from "@/components/BackgroundPlaybackGuard";
import { PageHeader } from "@/components/PageHeader";
import { PlayerBar } from "@/components/PlayerBar";
import { navigationRef, openPlayerScreen } from "@/navigation/navigationRef";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

/** push 页标题：只用于顶栏，不参与路由 */
const PAGE_TITLES: Record<string, string> = {
  PlaylistDetail: "歌单",
  AlbumDetail: "专辑",
  ArtistDetail: "歌手",
  // 以下页面在内容区已有自己的大标题/hero，顶栏只保留返回，避免同名标题出现两次
  DailyRecommend: "",
  CloudDrive: "",
  PersonalFm: "",
  LikedSongs: "",
  Leaderboard: "",
  SearchFallbackDetail: "搜索结果",
  PlaylistSquare: "歌单广场",
  LocalPlaylistDetail: "歌单",
  SimilarSongs: "相似歌曲",
  ListeningStats: "听歌统计",
  Settings: "设置",
};

/**
 * 这些页面已经自带页内顶栏（返回 + 标题）。
 * 不再额外渲染 PageHeader，避免两行返回键。
 */
const SELF_HEADER_ROUTES = new Set(["PlaylistDetail", "AlbumDetail", "ArtistDetail", "LocalPlaylistDetail", "PlaylistSquare", "ListeningStats", "SimilarSongs"]);

interface ActiveRoute {
  name: string;
  ancestors: string[];
}

interface AppShellController {
  showChrome: boolean;
  showHeader: boolean;
  showPlayerBar: boolean;
  applyTopSafeArea: boolean;
  statusBar: "default" | "light-content" | "dark-content";
  /** 安全区/窗口底色：深色主题下状态栏背衬必须为深色 */
  chromeBackground: string;
  pageTitle: string;
  canGoBack: boolean;
  goBack: () => void;
  activeRoute: ActiveRoute;
}

function findActiveRoute(state: NavigationState, ancestors: string[] = []): ActiveRoute | null {
  const activeRoute = state.routes[state.index ?? 0];
  if (!activeRoute) return null;
  const nestedState = activeRoute.state as NavigationState | undefined;
  return nestedState
    ? findActiveRoute(nestedState, [...ancestors, activeRoute.name])
    : { name: activeRoute.name, ancestors };
}

function useAppShellController(): AppShellController {
  const themeMode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(themeMode, systemTheme), accentColor),
    [themeMode, systemTheme, accentColor],
  );

  const [activeRoute, setActiveRoute] = useState<ActiveRoute>({ name: "HomeTab", ancestors: [] });
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    const syncFromNavigation = () => {
      const nextActiveRoute = findActiveRoute(navigationRef.getRootState());
      if (nextActiveRoute) {
        setActiveRoute(nextActiveRoute);
      }
      if (navigationRef.isReady()) {
        setCanGoBack(navigationRef.canGoBack());
      }
    };

    const unsubscribe = navigationRef.addListener("state", syncFromNavigation);
    if (navigationRef.isReady()) syncFromNavigation();
    return unsubscribe;
  }, []);

  const goBack = useCallback(() => {
    if (!navigationRef.isReady()) return;
    if (navigationRef.canGoBack()) {
      navigationRef.goBack();
    }
  }, []);

  // 根导航改为 Stack 后，系统返回只需处理「能否 pop」。
  // 设置页内部的「分类 → 首页」由 SettingsNavigator 自己拦截。
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!navigationRef.isReady()) return false;
      if (navigationRef.canGoBack()) {
        navigationRef.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, []);

  const isSettingsActive = activeRoute.name === "Settings" || activeRoute.ancestors.includes("Settings");
  const isPlayerActive = activeRoute.name === "Player" || activeRoute.ancestors.includes("Player");
  const isMvActive = activeRoute.name === "MvPlayer" || activeRoute.ancestors.includes("MvPlayer");
  const isMainTabs = activeRoute.ancestors.includes("MainTabs");
  const isFullScreenImmersive = isPlayerActive || isMvActive;
  const showChrome = !isMvActive;
  const showHeader = !isSettingsActive
    && !isFullScreenImmersive
    && !isMainTabs
    && !SELF_HEADER_ROUTES.has(activeRoute.name);
  const showPlayerBar = !isSettingsActive && !isFullScreenImmersive && !isMainTabs;

  return {
    showChrome,
    showHeader,
    showPlayerBar,
    applyTopSafeArea: !isSettingsActive && !isFullScreenImmersive,
    statusBar: isMvActive ? "light-content" : palette.statusBar,
    chromeBackground: isMvActive ? "#000" : palette.background,
    pageTitle: PAGE_TITLES[activeRoute.name] ?? "",
    canGoBack,
    goBack,
    activeRoute,
  };
}

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const insets = useSafeAreaInsets();
  const shellState = useAppShellController();

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: shellState.chromeBackground }]}
      edges={shellState.applyTopSafeArea ? ["top", "left", "right"] : ["left", "right"]}
    >
      <StatusBar barStyle={shellState.statusBar} />
      <BackgroundPlaybackGuard />
      {shellState.showChrome ? (
        <AppBackground>
          {shellState.showHeader ? (
            <PageHeader
              title={shellState.pageTitle}
              canGoBack={shellState.canGoBack}
              onGoBack={shellState.goBack}
            />
          ) : null}
          <View style={styles.content}>{children}</View>
          {shellState.showPlayerBar ? (
            <View style={[styles.playerDock, { paddingBottom: insets.bottom + 8 }]}>
              <PlayerBar onOpen={openPlayerScreen} bottomInset={insets.bottom} />
            </View>
          ) : null}
        </AppBackground>
      ) : (
        <View style={styles.content}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1 },
  playerDock: {
    // 安全区由外层 padding 处理，卡片本身保持 64px 高
    paddingBottom: 8,
  },
});
