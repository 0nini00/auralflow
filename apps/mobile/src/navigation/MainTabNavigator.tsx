import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { createBottomTabNavigator, type BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { Home, Library, Search, User } from "lucide-react-native";
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
import { AppTabBar } from "@/components/AppTabBar";
import { IconButton } from "@/components/IconButton";
import { LargeHeader } from "@/components/LargeHeader";
import { MAIN_TAB_BAR_HEIGHT } from "@/navigation/tabLayout";
import type { MainTabParamList } from "@/navigation/types";
import { typography } from "@/theme/tokens";
import { withAlpha } from "@/services/themePaletteModel";

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

function LibraryTabContent() {
  return (
    <View style={{ flex: 1 }}>
      <LargeHeader
        title="音乐库"
        right={(
          <IconButton
            size="sm"
            tone="strong"
            accessibilityLabel="搜索"
            onPress={openSearchScreen}
            render={({ size, color }) => <Search size={size} color={color} />}
          />
        )}
      />
      <LibraryScreen onNavigateToPlayer={openPlayerScreen} />
    </View>
  );
}

function MyMusicTabContent() {
  return <MyMusicScreen onNavigateToPlayer={openPlayerScreen} />;
}

export function MainTabNavigator() {
  const insets = useSafeAreaInsets();
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );

  // 键盘状态监听分工：此处的 keyboardVisible 决定 tabBar 是否渲染迷你栏；
  // PlayerBar 内部的 Keyboard 监听服务于 push 页（无 tabBar 时由 AppShell 渲染），
  // 两处各自独立、互不冲突。
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
      tabBar={(props) => <AppTabBar {...props} keyboardVisible={keyboardVisible} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.primaryInk,
        tabBarInactiveTintColor: palette.textMuted,
        // 高度固定 64：BottomTabBar 的 tabBarStyle 在样式数组末尾，会覆盖内部计算值。
        // 内容区让位由 BottomTabView 按 tabBar 元素实际高度自动完成。
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopWidth: 1,
          borderTopColor: palette.border,
          // 高度含底部安全区：手势条区域同底色，标签不被遮挡
          height: MAIN_TAB_BAR_HEIGHT + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 4,
        },
        tabBarLabelStyle: {
          fontSize: typography.micro,
          fontWeight: "600",
        },
        tabBarIconStyle: {
          marginBottom: -1,
        },
      }}
    >
      <BottomTab.Screen
        name="HomeTab"
        component={HomeScreenWrapper}
        options={{
          tabBarLabel: "首页",
          tabBarIcon: ({ color, focused }) => (
            <View style={tabIconStyle(focused, palette)}>
              <Home size={20} color={color} strokeWidth={focused ? 2.1 : 1.8} />
            </View>
          ),
        }}
      />
      <BottomTab.Screen
        name="SearchTab"
        component={SearchScreenWrapper}
        options={{
          tabBarLabel: "搜索",
          tabBarIcon: ({ color, focused }) => (
            <View style={tabIconStyle(focused, palette)}>
              <Search size={20} color={color} strokeWidth={focused ? 2.1 : 1.8} />
            </View>
          ),
        }}
      />
      <BottomTab.Screen
        name="LibraryTab"
        component={LibraryTabContent}
        options={{
          tabBarLabel: "音乐库",
          tabBarIcon: ({ color, focused }) => (
            <View style={tabIconStyle(focused, palette)}>
              <Library size={20} color={color} strokeWidth={focused ? 2.1 : 1.8} />
            </View>
          ),
        }}
      />
      <BottomTab.Screen
        name="MyMusicTab"
        component={MyMusicTabContent}
        options={{
          tabBarLabel: "我的",
          tabBarIcon: ({ color, focused }) => (
            <View style={tabIconStyle(focused, palette)}>
              <User size={20} color={color} strokeWidth={focused ? 2.1 : 1.8} />
            </View>
          ),
        }}
      />
    </BottomTab.Navigator>
  );
}

function tabIconStyle(focused: boolean, palette: ReturnType<typeof getThemePalette>) {
  return {
    width: 34,
    height: 24,
    borderRadius: 9,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: focused ? withAlpha(palette.primaryInk, 0.15) : "transparent",
  };
}
