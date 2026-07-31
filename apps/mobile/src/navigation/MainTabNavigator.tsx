import React from "react";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Home, Library, User, Search } from "lucide-react-native";
import { useTheme } from "@/theme/useTheme";
import { HomeScreen } from "@/screens/HomeScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { MyMusicScreen } from "@/screens/MyMusicScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { openPlayerScreen } from "@/navigation/navigationRef";
import type {
  MainTabParamList,
  LibraryTopTabParamList,
  MyMusicTopTabParamList,
} from "@/navigation/types";

const TopTab = createMaterialTopTabNavigator<LibraryTopTabParamList>();
const MyMusicTopTab = createMaterialTopTabNavigator<MyMusicTopTabParamList>();
const BottomTab = createBottomTabNavigator<MainTabParamList>();

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
  const { colors } = useTheme();

  return (
    <TopTab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        tabBarIndicatorStyle: {
          backgroundColor: colors.primary,
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
  const { colors } = useTheme();

  return (
    <MyMusicTopTab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        tabBarIndicatorStyle: {
          backgroundColor: colors.primary,
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
  const { colors } = useTheme();

  return (
    <BottomTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
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
        component={HomeScreen}
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
        component={SearchScreen}
        options={{
          tabBarLabel: "搜索",
          tabBarIcon: ({ color, size }) => <Search size={size} color={color} />,
        }}
      />
    </BottomTab.Navigator>
  );
}
