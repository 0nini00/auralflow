import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDrawerStatusFromState } from "@react-navigation/drawer";
import {
  DrawerActions,
  type DrawerNavigationState,
  type NavigationState,
  type NavigatorScreenParams,
  type ParamListBase,
  type PartialState,
} from "@react-navigation/native";
import { BackHandler, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBackground } from "@/components/AppBackground";
import { AppHeader, type AppHeaderProps } from "@/components/AppHeader";
import { PlayerBar } from "@/components/PlayerBar";
import {
  applyNavigationState,
  createMainNavigationTarget,
  createNavigationHistory,
  createRootNavigationTarget,
  moveBackward,
  moveForward,
  navigationObservationsEqual,
  navigationReplayTargetsEqual,
  type NavigationHistory,
  type NavigationMove,
  type NavigationTarget,
} from "@/navigation/navigationHistoryModel";
import { navigateRoot, navigationRef, openPlayerScreen } from "@/navigation/navigationRef";
import type { MainDrawerParamList, RootStackParamList } from "@/navigation/types";
import {
  deriveAppShellNavigationState,
  type AppShellNavigationState,
} from "@/services/appShellModel";
import { useSearchQueryStore } from "@/stores/searchQueryStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

type NavigationTree = NavigationState | PartialState<NavigationState>;
type MainRouteName = keyof MainDrawerParamList;
type RootRouteName = Exclude<keyof RootStackParamList, "Main">;
type AppNavigationTarget = NavigationTarget<MainRouteName, RootRouteName>;

interface AppShellController {
  showChrome: boolean;
  statusBar: "default" | "light-content" | "dark-content";
  headerProps: AppHeaderProps;
}

const MAIN_ROUTE_NAMES = [
  "Home",
  "Search",
  "Daily",
  "FM",
  "Playlists",
  "Local",
  "Downloads",
  "Library",
  "Settings",
] as const satisfies readonly MainRouteName[];

const ROOT_ROUTE_NAMES = [
  "Player",
  "ArtistDetail",
  "AlbumDetail",
  "PlaylistDetail",
  "LocalPlaylistDetail",
  "BiliCollectionDetail",
  "LikedSongs",
  "SearchFallbackDetail",
] as const satisfies readonly RootRouteName[];

function isMainRouteName(value: string): value is MainRouteName {
  return (MAIN_ROUTE_NAMES as readonly string[]).includes(value);
}

function isRootRouteName(value: string): value is RootRouteName {
  return (ROOT_ROUTE_NAMES as readonly string[]).includes(value);
}

function getActiveRoute(state: NavigationTree) {
  return state.routes[state.index ?? 0];
}

function deriveNavigationTarget(state?: NavigationState): AppNavigationTarget | null {
  if (!state) return null;

  const rootRoute = getActiveRoute(state);
  if (!rootRoute) return null;

  if (rootRoute.name !== "Main") {
    if (!isRootRouteName(rootRoute.name)) {
      throw new Error(`Unsupported root navigation target: ${rootRoute.name}`);
    }
    return createRootNavigationTarget(rootRoute.name, rootRoute.params);
  }

  const mainState = rootRoute.state as NavigationTree | undefined;
  if (!mainState) return null;

  const mainRoute = getActiveRoute(mainState);
  if (!mainRoute) return null;
  if (!isMainRouteName(mainRoute.name)) {
    throw new Error(`Unsupported main navigation target: ${mainRoute.name}`);
  }

  return createMainNavigationTarget(mainRoute.name, mainRoute.params);
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

function findMainDrawerKey(state?: NavigationState): string | null {
  if (!state) return null;
  if (
    state.type === "drawer" &&
    state.routes.some((route) => route.name === "Home") &&
    state.routes.some((route) => route.name === "Settings")
  ) {
    return state.key;
  }
  const activeRoute = state.routes[state.index ?? 0];
  return findMainDrawerKey(activeRoute?.state as NavigationState | undefined);
}

function hasNestedSettingsDetail(state?: NavigationState): boolean {
  if (!state) return false;
  const activeRoute = state.routes[state.index ?? 0];
  if (state.type === "stack" && state.index > 0 && activeRoute?.name !== "Main") {
    return true;
  }
  return hasNestedSettingsDetail(activeRoute?.state as NavigationState | undefined);
}

function replayNavigation(target: AppNavigationTarget) {
  if (target.kind === "main") {
    navigateRoot("Main", {
      screen: target.name,
      params: target.params,
    } as NavigatorScreenParams<MainDrawerParamList>);
    return;
  }

  navigateRoot(target.name, target.params as RootStackParamList[RootRouteName]);
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

  const [navigationState, setNavigationState] = useState<AppShellNavigationState>(() =>
    deriveAppShellNavigationState(),
  );
  const [history, setHistory] = useState(() =>
    createNavigationHistory<AppNavigationTarget>(createMainNavigationTarget("Home")),
  );
  const historyRef = useRef(history);
  const pendingReplayRef = useRef<AppNavigationTarget | null>(null);

  useEffect(() => {
    const syncFromNavigation = () => {
      const rootState = navigationRef.getRootState();
      setNavigationState(deriveAppShellNavigationState(rootState));

      const target = deriveNavigationTarget(rootState);
      if (target) {
        const transition = applyNavigationState(
          historyRef.current,
          target,
          pendingReplayRef.current,
          navigationObservationsEqual,
          navigationReplayTargetsEqual,
        );
        historyRef.current = transition.history;
        pendingReplayRef.current = transition.pendingReplay;
        setHistory(transition.history);
      }
    };

    const unsubscribe = navigationRef.addListener("state", syncFromNavigation);
    if (navigationRef.isReady()) syncFromNavigation();
    return unsubscribe;
  }, []);

  const openDrawer = useCallback(() => {
    if (!navigationRef.isReady()) return;
    const mainDrawerKey = findMainDrawerKey(navigationRef.getRootState());
    if (!mainDrawerKey) throw new Error("Main drawer is unavailable");
    navigationRef.dispatch({
      ...DrawerActions.openDrawer(),
      target: mainDrawerKey,
    });
  }, []);

  const replayMove = useCallback((move: NavigationMove<AppNavigationTarget>): boolean => {
    if (!move.value) return false;
    pendingReplayRef.current = move.value;
    historyRef.current = move.history;
    setHistory(move.history);
    replayNavigation(move.value);
    return true;
  }, []);

  const goBack = useCallback(() => {
    if (!navigationRef.isReady()) return false;
    return replayMove(moveBackward(historyRef.current));
  }, [replayMove]);

  const goForward = useCallback(() => {
    if (!navigationRef.isReady()) return false;
    return replayMove(moveForward(historyRef.current));
  }, [replayMove]);

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
      if (hasNestedSettingsDetail(rootState) && navigationRef.canGoBack()) {
        navigationRef.goBack();
        return true;
      }
      return goBack();
    });
    return () => subscription.remove();
  }, [goBack]);

  const submitSearch = useCallback((keyword: string) => {
    navigateRoot("Main", {
      screen: "Search",
      params: { initialKeyword: keyword || undefined },
    });
  }, []);

  return {
    showChrome: navigationState.showChrome,
    statusBar: palette.statusBar,
    headerProps: {
      canGoBack: history.index > 0,
      canGoForward: history.index < history.entries.length - 1,
      onOpenDrawer: openDrawer,
      onGoBack: goBack,
      onGoForward: goForward,
      onSubmitSearch: submitSearch,
      seedQuery: navigationState.activeRouteName === "Search" ? lastKeyword : "",
    },
  };
}

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const insets = useSafeAreaInsets();
  const shellState = useAppShellController();

  if (!shellState.showChrome) return <>{children}</>;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle={shellState.statusBar} />
      <AppBackground>
        <AppHeader {...shellState.headerProps} />
        <View style={styles.content}>{children}</View>
        <PlayerBar onOpen={openPlayerScreen} bottomInset={insets.bottom} />
      </AppBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1 },
});
