import React from "react";
import { useWindowDimensions } from "react-native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { DrawerContent } from "@/components/DrawerContent";
import { MainTabNavigator } from "@/navigation/MainTabNavigator";
import type { MainDrawerParamList } from "@/navigation/types";

const Drawer = createDrawerNavigator<MainDrawerParamList>();

export function MainDrawerNavigator() {
  const { width } = useWindowDimensions();
  const sidebarWidth = Math.min(300, Math.round(width * 0.78));

  return (
    <Drawer.Navigator
      initialRouteName="MainTabs"
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
      <Drawer.Screen name="MainTabs" component={MainTabNavigator} />
    </Drawer.Navigator>
  );
}
