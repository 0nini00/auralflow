import React from "react";
import { useWindowDimensions } from "react-native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { DrawerContent } from "@/components/DrawerContent";
import { RootNavigator } from "@/navigation/RootNavigator";
import { SettingsNavigator } from "@/navigation/SettingsNavigator";
import type { MainDrawerParamList } from "@/navigation/types";

const Drawer = createDrawerNavigator<MainDrawerParamList>();

/**
 * 根抽屉导航：包住「主页栈（RootNavigator）」与「设置」，抽屉在根层级渲染，
 * 因此推入页（歌单详情/每日推荐/排行榜等）也能直接打开侧边栏。
 */
export function MainDrawerNavigator() {
  const { width } = useWindowDimensions();
  const sidebarWidth = Math.min(300, Math.round(width * 0.78));

  return (
    <Drawer.Navigator
      initialRouteName="Main"
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: "front",
        drawerStyle: { width: sidebarWidth },
        overlayColor: "rgba(0, 0, 0, 0.45)",
        swipeEnabled: true,
        swipeEdgeWidth: 24,
      }}
    >
      <Drawer.Screen name="Main" component={RootNavigator} />
      <Drawer.Screen name="Settings" component={SettingsNavigator} />
    </Drawer.Navigator>
  );
}
