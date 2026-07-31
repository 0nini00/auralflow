import React, { useMemo } from "react";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Home, Library, User, Search } from "lucide-react-native";
import { HomeScreen } from "@/screens/HomeScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { MyMusicScreen } from "@/screens/MyMusicScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { openPlayerScreen } from "@/navigation/navigationRef";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import type {
  MainTabParamList,
  LibraryTopTabParamList,
  MyMusicTopTabParamList,
} from "@/navigation/types";

const TopTab = createMaterialTopTabNavigator<LibraryTopTabParamList>();
const MyMusicTopTab = createMaterialTopTabNavigator<MyMusicTopTabParamList>();
const BottomTab = createBottomTabNavigator<MainTabParamList>();

function HomeScreenWrapper() {
  return (
    <HomeScreen
      onNavigateToPlayer={openPlayerScreen}
      onNavigateToSearch={() => {}}
    />
  );
}

function SearchScreenWrapper() {
  return (
    <SearchScreen
      onNavigateToPlayer={openPlayerScreen}
      initialKeyword={null}
      onInitialKeywordConsumed={() => {}}
      initialDetailRoute={null}
      onInitialDetailRouteConsumed={() => {}}
    />
  );
}

function PlaylistsScreen() {
  return (
    <LibraryScreen
      onNavigateToPlayer={openPlayerScreen}
      activeSection="playlists"
      onSelectSection={() => {}}
    />
  );
}

function BiliScreen() {
  return (
    <LibraryScreen
      onNavigateToPlayer={openPlayerScreen}
      activeSection="bili"
      onSelectSection={() => {}}
    />
  );
}

function LibraryTopTabs() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  return (
    <TopTab.Navigator
      screenOptions={{
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textSubtle,
        tabBarStyle: {
          backgroundColor: palette.surface,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
        },
        tabBarIndicatorStyle: {
          backgroundColor: palette.primary,
        },
        tabBarLabelStyle: {
          fontSize: 14,
          fontWeight: "600",
        },
        swipeEnabled: true,
      }}
    >
      <TopTab.Screen name="Playlists" component={PlaylistsScreen} options={{ tabBarLabel: "歌单" }} />
      <TopTab.Screen name="Bili" component={BiliScreen} options={{ tabBarLabel: "B站" }} />
    </TopTab.Navigator>
  );
}

function LocalScreen() {
  return (
    <MyMusicScreen
      tab="local"
      onNavigateToPlayer={openPlayerScreen}
    />
  );
}

function HistoryScreen() {
  return (
    <MyMusicScreen
      tab="history"
      onNavigateToPlayer={openPlayerScreen}
    />
  );
}

function DownloadsScreen() {
  return (
    <MyMusicScreen
      tab="downloads"
      onNavigateToPlayer={openPlayerScreen}
    />
  );
}

function MyMusicTopTabs() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  return (
    <MyMusicTopTab.Navigator
      screenOptions={{
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textSubtle,
        tabBarStyle: {
          backgroundColor: palette.surface,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
        },
        tabBarIndicatorStyle: {
          backgroundColor: palette.primary,
        },
        tabBarLabelStyle: {
          fontSize: 14,
          fontWeight: "600",
        },
        swipeEnabled: true,
      }}
    >
      <MyMusicTopTab.Screen name="Local" component={LocalScreen} options={{ tabBarLabel: "本地" }} />
      <MyMusicTopTab.Screen name="History" component={HistoryScreen} options={{ tabBarLabel: "历史" }} />
      <MyMusicTopTab.Screen name="Downloads" component={DownloadsScreen} options={{ tabBarLabel: "下载" }} />
    </MyMusicTopTab.Navigator>
  );
}

export function MainTabNavigator() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  return (
    <BottomTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textSubtle,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopWidth: 1,
          borderTopColor: palette.border,
          height: 56,
          paddingBottom: 4,
          paddingTop: 4,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "500",
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
      }}
    >
      <BottomTab.Screen
        name="HomeTab"
        component={HomeScreenWrapper}
        options={{
          tabBarLabel: "发现",
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <BottomTab.Screen
        name="LibraryTab"
        component={LibraryTopTabs}
        options={{
          tabBarLabel: "曲库",
          tabBarIcon: ({ color, size }) => <Library size={size} color={color} />,
        }}
      />
      <BottomTab.Screen
        name="MyMusicTab"
        component={MyMusicTopTabs}
        options={{
          tabBarLabel: "我的",
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
        }}
      />
      <BottomTab.Screen
        name="SearchTab"
        component={SearchScreenWrapper}
        options={{
          tabBarLabel: "搜索",
          tabBarIcon: ({ color, size }) => <Search size={size} color={color} />,
        }}
      />
    </BottomTab.Navigator>
  );
}
