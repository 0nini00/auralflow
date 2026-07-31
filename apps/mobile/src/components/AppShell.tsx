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
  statusBar: "default" | "light-content" | "dark-content";
  headerProps: AppHeaderProps;
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
    state.routes.some((route) => route.name === "MainTabs")
  ) {
    return state.key;
  }
  const activeRoute = state.routes[state.index ?? 0];
  return findMainDrawerKey(activeRoute?.state as NavigationState | undefined);
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

  const [activeRouteName, setActiveRouteName] = useState<string>("HomeTab");

  useEffect(() => {
    const syncFromNavigation = () => {
      const rootState = navigationRef.getRootState();
      const mainState = rootState.routes[0]?.state as NavigationState | undefined;
      if (mainState) {
        const activeRoute = mainState.routes[mainState.index ?? 0];
        if (activeRoute) {
          setActiveRouteName(activeRoute.name);
        }
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

  const isSearchActive = activeRouteName === "SearchTab";

  return {
    showChrome: true,
    statusBar: palette.statusBar,
    headerProps: {
      canGoBack: false,
      onOpenDrawer: openDrawer,
      onGoBack: goBack,
      onSubmitSearch: submitSearch,
      seedQuery: isSearchActive ? lastKeyword : "",
    },
  };
}

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const insets = useSafeAreaInsets();
  const shellState = useAppShellController();

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
