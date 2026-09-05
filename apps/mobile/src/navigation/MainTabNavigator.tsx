import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { createMaterialTopTabNavigator, type MaterialTopTabNavigationProp } from "@react-navigation/material-top-tabs";
import {
  BottomTabBar,
  createBottomTabNavigator,
  type BottomTabBarProps,
  type BottomTabNavigationProp,
} from "@react-navigation/bottom-tabs";
import { Home, Library, User, Search } from "lucide-react-native";
import { HomeScreen } from "@/screens/HomeScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { MyMusicScreen } from "@/screens/MyMusicScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import {
  openHistoryScreen,
  openPersonalFmScreen,
  openPlayerScreen,
  openSearchScreen,
} from "@/navigation/navigationRef";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";
import { useBiliAccountStore } from "@/stores/biliAccountStore";
import { PlayerBar } from "@/components/PlayerBar";
import { MAIN_TAB_BAR_HEIGHT } from "@/navigation/tabLayout";
import { usePlayerStore } from "@/stores/playerStore";
import type {
  MainTabParamList,
  LibraryTopTabParamList,
} from "@/navigation/types";

const TopTab = createMaterialTopTabNavigator<LibraryTopTabParamList>();
const BottomTab = createBottomTabNavigator<MainTabParamList>();

function HomeScreenWrapper() {
  return (
    <HomeScreen
      onNavigateToSearch={openSearchScreen}
      onNavigateToFm={openPersonalFmScreen}
      onNavigateToHistory={openHistoryScreen}
    />
  );
}

function SearchScreenWrapper() {
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList, "SearchTab">>();
  const route = useRoute<RouteProp<MainTabParamList, "SearchTab">>();
  // useCallback 稳定引用：SearchScreen 的 initialKeyword/initialDetailRoute
  // effect 依赖该回调，引用不稳定会在每次 wrapper 重渲染时重新触发
  // （重复执行搜索/重复打开详情页）。
  const clearInitialParams = useCallback(() => navigation.setParams({
    initialKeyword: undefined,
    initialDetailRoute: null,
  }), [navigation]);
  return (
    <SearchScreen
      onNavigateToPlayer={openPlayerScreen}
      initialKeyword={route.params?.initialKeyword ?? null}
      onInitialKeywordConsumed={clearInitialParams}
      initialDetailRoute={route.params?.initialDetailRoute ?? null}
      onInitialDetailRouteConsumed={clearInitialParams}
    />
  );
}

function LocalScreen() {
  const navigation = useNavigation<MaterialTopTabNavigationProp<LibraryTopTabParamList>>();
  return (
    <LibraryScreen
      onNavigateToPlayer={openPlayerScreen}
      activeSection="local"
      onSelectSection={(section) => navigation.navigate(sectionToTopTab(section))}
    />
  );
}

function HistoryScreen() {
  const navigation = useNavigation<MaterialTopTabNavigationProp<LibraryTopTabParamList>>();
  return (
    <LibraryScreen
      onNavigateToPlayer={openPlayerScreen}
      activeSection="history"
      onSelectSection={(section) => navigation.navigate(sectionToTopTab(section))}
    />
  );
}

function DownloadsScreen() {
  const navigation = useNavigation<MaterialTopTabNavigationProp<LibraryTopTabParamList>>();
  return (
    <LibraryScreen
      onNavigateToPlayer={openPlayerScreen}
      activeSection="downloads"
      onSelectSection={(section) => navigation.navigate(sectionToTopTab(section))}
    />
  );
}

function BiliScreen() {
  const navigation = useNavigation<MaterialTopTabNavigationProp<LibraryTopTabParamList>>();
  return (
    <LibraryScreen
      onNavigateToPlayer={openPlayerScreen}
      activeSection="bili"
      onSelectSection={(section) => navigation.navigate(sectionToTopTab(section))}
    />
  );
}

function sectionToTopTab(section: "local" | "history" | "downloads" | "bili"): keyof LibraryTopTabParamList {
  return section === "local" ? "Local"
    : section === "history" ? "History"
      : section === "downloads" ? "Downloads" : "Bili";
}

function LibraryTopTabs() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  // 收敛方案：B站未登录时隐藏「B站合集」Tab，登录/退出只在设置 → 账号与服务
  const biliAccount = useBiliAccountStore((state) => state.account);
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
      <TopTab.Screen name="Local" component={LocalScreen} options={{ tabBarLabel: "本地音乐" }} />
      <TopTab.Screen name="History" component={HistoryScreen} options={{ tabBarLabel: "播放历史" }} />
      <TopTab.Screen name="Downloads" component={DownloadsScreen} options={{ tabBarLabel: "下载" }} />
      {biliAccount ? (
        <TopTab.Screen name="Bili" component={BiliScreen} options={{ tabBarLabel: "B站合集" }} />
      ) : null}
    </TopTab.Navigator>
  );
}

function MyMusicTabContent() {
  return <MyMusicScreen onNavigateToPlayer={openPlayerScreen} />;
}

/**
 * 迷你播放器 + 四个导航键的自定义底部栏。
 *
 * 迷你播放器作为 BottomTabBar 的上一行（文档流）渲染，导航键本身完全不变；
 * 有歌时 tabBar 总高 = 迷你栏 + 导航键，react-navigation 自动为内容区让位，零遮挡。
 * 键盘弹出时迷你栏隐藏（对齐 lx PlayerBar）。
 */
function MiniPlayerTabBar({ keyboardVisible, ...props }: BottomTabBarProps & { keyboardVisible: boolean }) {
  const currentSong = usePlayerStore((state) => state.currentSong);
  const showMiniPlayer = Boolean(currentSong) && !keyboardVisible;
  return (
    <View style={{ flexDirection: "column" }}>
      {showMiniPlayer ? <PlayerBar onOpen={openPlayerScreen} /> : null}
      {/* style 仅参与 getTabBarHeight 计算（隐藏动画位移），渲染高度由 tabBarStyle.height 决定（已固定 56） */}
      <BottomTabBar {...props} style={{ height: MAIN_TAB_BAR_HEIGHT }} />
    </View>
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

  // 键盘状态监听分工：此处的 keyboardVisible 决定 tabBar 是否渲染迷你栏；
  // PlayerBar 内部的 Keyboard 监听服务于 push 页（无 tabBar 时由 AppShell 渲染），两处各自独立、互不冲突。
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return (
    <BottomTab.Navigator
      tabBar={(props) => <MiniPlayerTabBar {...props} keyboardVisible={keyboardVisible} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textSubtle,
        // 注意：height 必须保持 MAIN_TAB_BAR_HEIGHT 固定。
        // BottomTabBar 渲染时 tabBarStyle 在样式数组末尾，会覆盖内部计算的 height；
        // 若动态增大到“迷你栏+导航键”，会把导航键区域拉高导致下方白屏。
        // 内容区让位由 BottomTabView 的 screens(flex:1) 按 tabBar 元素实际高度自动完成。
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopWidth: 1,
          borderTopColor: palette.border,
          height: MAIN_TAB_BAR_HEIGHT,
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
          tabBarLabel: "首页",
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
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
        component={MyMusicTabContent}
        options={{
          tabBarLabel: "我的",
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
        }}
      />
    </BottomTab.Navigator>
  );
}
