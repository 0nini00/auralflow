import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getDrawerStatusFromState } from "@react-navigation/drawer";
import {
  DrawerActions,
  type DrawerNavigationState,
  type NavigationState,
  type ParamListBase,
} from "@react-navigation/native";
import { BackHandler, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { AppHeader, type AppHeaderProps } from "@/components/AppHeader";
import { PlayerBar } from "@/components/PlayerBar";
import { navigateRoot, navigationRef, openPlayerScreen } from "@/navigation/navigationRef";
import { useSearchQueryStore } from "@/stores/searchQueryStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

interface AppShellController {
  showChrome: boolean;
  showHeader: boolean;
  showPlayerBar: boolean;
  applyTopSafeArea: boolean;
  statusBar: "default" | "light-content" | "dark-content";
  /** 安全区/窗口底色：深色主题下状态栏背衬必须为深色，否则白色窗口底透出、白色状态图标不可见 */
  chromeBackground: string;
  headerProps: AppHeaderProps;
  /** 当前激活路由（含祖先链），用于判断是否位于底部 Tab 导航器内。 */
  activeRoute: ActiveRoute;
}

function findOpenDrawerKey(state?: NavigationState): string | null {
  if (!state) return null;
  const activeRoute = state.routes[state.index ?? 0];
  const nested = activeRoute?.state as NavigationState | undefined;
  const nestedKey = findOpenDrawerKey(nested);
  if (nestedKey) return nestedKey;
  if (state.type !== "drawer") return null;
  return getDrawerStatusFromState(
    state as DrawerNavigationState<ParamListBase>,
  ) === "open"
    ? state.key
    : null;
}

interface ActiveRoute {
  name: string;
  ancestors: string[];
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
  const lastKeyword = useSearchQueryStore((state) => state.lastKeyword);
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

  const openDrawer = useCallback(() => {
    if (!navigationRef.isReady()) return;
    // 抽屉已提升为根导航：任何页面（含推入页）都能直接打开侧边栏。
    navigationRef.dispatch(DrawerActions.openDrawer());
  }, []);

  const goBack = useCallback(() => {
    if (!navigationRef.isReady()) return;
    if (navigationRef.canGoBack()) {
      navigationRef.goBack();
    }
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!navigationRef.isReady()) return false;
      const rootState = navigationRef.getRootState();
      const openDrawerKey = findOpenDrawerKey(rootState);
      if (openDrawerKey) {
        navigationRef.dispatch({
          ...DrawerActions.closeDrawer(),
          target: openDrawerKey,
        });
        return true;
      }
      if (navigationRef.canGoBack()) {
        navigationRef.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, []);

  const submitSearch = useCallback((keyword: string) => {
    navigateRoot("Main", {
      screen: "MainTabs",
      params: {
        screen: "SearchTab",
        params: { initialKeyword: keyword || undefined },
      },
    });
  }, []);

  const isSearchActive = activeRoute.name === "SearchTab";
  const isSettingsActive = activeRoute.name === "Settings" || activeRoute.ancestors.includes("Settings");
  const showChrome = activeRoute.name !== "MvPlayer";

  return {
    showChrome,
    showHeader: !isSettingsActive,
    showPlayerBar: !isSettingsActive,
    applyTopSafeArea: !isSettingsActive,
    statusBar: showChrome ? palette.statusBar : "light-content",
    chromeBackground: showChrome ? palette.background : "#000",
    headerProps: {
      canGoBack,
      onOpenDrawer: openDrawer,
      onGoBack: goBack,
      onSubmitSearch: submitSearch,
      seedQuery: isSearchActive ? lastKeyword : "",
    },
    activeRoute,
  };
}

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const insets = useSafeAreaInsets();
  const shellState = useAppShellController();

  // 当前是否位于底部 Tab 导航器内：Tab 页的迷你播放器已内嵌于自定义 tabBar
  // （导航键上方一行，文档流），AppShell 无需再渲染；push 页面（歌单详情等）
  // 无 Tab 栏，由 AppShell 文档流贴底渲染，内容区自动让位，零遮挡。
  const isMainTabs = shellState.activeRoute.ancestors.includes("MainTabs");

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: shellState.chromeBackground }]}
      edges={shellState.applyTopSafeArea ? ["top", "left", "right"] : ["left", "right"]}
    >
      <StatusBar barStyle={shellState.statusBar} />
      {shellState.showChrome ? (
        <AppBackground>
          {shellState.showHeader ? <AppHeader {...shellState.headerProps} /> : null}
          <View style={styles.content}>{children}</View>
          {shellState.showPlayerBar && !isMainTabs ? (
            <PlayerBar onOpen={openPlayerScreen} bottomInset={insets.bottom} />
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
});
