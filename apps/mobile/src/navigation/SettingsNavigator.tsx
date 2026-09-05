import React, { useEffect, useMemo } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";
import { CommonActions, DrawerActions } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";

import { navigationRef } from "@/navigation/navigationRef";
import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryName,
} from "@/navigation/settingsRouteModel";
import { IconButton } from "@/components/IconButton";
import { AboutSettingsScreen } from "@/screens/settings/AboutSettingsScreen";
import { AccountSettingsScreen } from "@/screens/settings/AccountSettingsScreen";
import { AppearanceSettingsScreen } from "@/screens/settings/AppearanceSettingsScreen";
import { DataSettingsScreen } from "@/screens/settings/DataSettingsScreen";
import { LyricsSettingsScreen } from "@/screens/settings/LyricsSettingsScreen";
import { PlaybackSettingsScreen } from "@/screens/settings/PlaybackSettingsScreen";
import { SettingsHomeScreen } from "@/screens/settings/SettingsHomeScreen";
import { SourcesSettingsScreen } from "@/screens/settings/SourcesSettingsScreen";
import { SyncSettingsScreen } from "@/screens/settings/SyncSettingsScreen";
import { useSettingsCategoryStore } from "@/stores/settingsCategoryStore";
import { getResolvedTheme, getThemePalette, useThemeStore } from "@/stores/themeStore";

type SettingsPageName = SettingsCategoryName | "SettingsHome";

const SETTINGS_PAGE_COMPONENTS: Record<SettingsPageName, React.ComponentType> = {
  SettingsHome: SettingsHomeScreen,
  Account: AccountSettingsScreen,
  Playback: PlaybackSettingsScreen,
  Lyrics: LyricsSettingsScreen,
  Appearance: AppearanceSettingsScreen,
  Sources: SourcesSettingsScreen,
  Sync: SyncSettingsScreen,
  Data: DataSettingsScreen,
  About: AboutSettingsScreen,
};

const SETTINGS_PAGE_TITLES = {
  SettingsHome: "设置",
  ...Object.fromEntries(SETTINGS_CATEGORIES.map((item) => [item.name, item.label])),
} as Record<SettingsPageName, string>;

/**
 * 设置区：不使用嵌套导航栈。
 *
 * 分类切换 = 分类请求 store（抽屉点击写入）变化 → 直接渲染对应页面组件。
 * 之前用嵌套 native-stack + 路由 params 的方案反复出问题：reset 纠正打断转场
 * 动画（打开分类页卡顿）、嵌套 navigate 的参数合并导致重挂载不触发（退出后
 * 点另一个分类仍显示旧页面）。纯组件切换彻底消灭这类导航状态问题。
 *
 * 返回行为（页内返回键与系统返回手势一致）：切回主界面并展开侧边栏设置页。
 */
export function SettingsNavigator() {
  const mode = useThemeStore((state) => state.mode);
  const systemTheme = useThemeStore((state) => state.systemTheme);
  const accentColor = useThemeStore((state) => state.accentColor);
  const palette = useMemo(
    () => getThemePalette(getResolvedTheme(mode, systemTheme), accentColor),
    [mode, systemTheme, accentColor],
  );
  useSettingsBackInterceptor();

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <SettingsTopBar palette={palette} />
      <ActiveSettingsPage />
    </View>
  );
}

function ActiveSettingsPage() {
  const category = useSettingsCategoryStore((state) => state.category);
  const Page = SETTINGS_PAGE_COMPONENTS[category];
  return <Page />;
}

function SettingsTopBar({
  palette,
}: {
  palette: ReturnType<typeof getThemePalette>;
}) {
  const insets = useSafeAreaInsets();
  const category = useSettingsCategoryStore((state) => state.category);
  const title = SETTINGS_PAGE_TITLES[category];

  return (
    <View
      style={[
        styles.topBar,
        { backgroundColor: palette.surface, paddingTop: insets.top, borderBottomColor: palette.border },
      ]}
    >
      <IconButton
        render={({ size, color }) => <ChevronLeft size={size} color={color} />}
        accessibilityLabel="返回"
        tone="strong"
        onPress={() => {
          // 设置页层级里没有「上一页」：返回 = 切回主界面并自动展开侧边栏
          // 设置页（底下是首页），可继续切换分类或收起侧边栏回到首页。
          navigationRef.dispatch(CommonActions.navigate("Main"));
          navigationRef.dispatch(DrawerActions.openDrawer());
        }}
        style={{ marginLeft: -8 }}
      />
      <Text style={[styles.topBarTitle, { color: palette.text }]}>{title}</Text>
      <View style={styles.topBarSpacer} />
    </View>
  );
}

/** 安卓返回键/手势：设置页返回 = 切回主界面并展开侧边栏（与页内返回键一致）。 */
export function useSettingsBackInterceptor() {
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!navigationRef.isReady()) return false;
      const root = navigationRef.getRootState();
      const active = root.routes[root.index];
      if (active?.name !== "Settings") return false;
      navigationRef.dispatch(CommonActions.navigate("Main"));
      navigationRef.dispatch(DrawerActions.openDrawer());
      return true;
    });
    return () => subscription.remove();
  }, []);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBarTitle: {
    flex: 1,
    textAlign: "left",
    fontSize: 18,
    fontWeight: "700",
  },
  topBarSpacer: {
    width: 40,
  },
});
