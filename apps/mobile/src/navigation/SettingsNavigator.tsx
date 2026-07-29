import React from "react";
import { useWindowDimensions } from "react-native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { SettingsDrawerContent } from "@/components/settings/SettingsDrawerContent";
import type { SettingsDrawerParamList, SettingsStackParamList } from "@/navigation/types";
import { DEFAULT_SETTINGS_CATEGORY } from "@/navigation/settingsRouteModel";
import { LoginScreen } from "@/screens/LoginScreen";
import { WebDavSyncScreen } from "@/screens/WebDavSyncScreen";
import { CustomSourceScreen } from "@/screens/CustomSourceScreen";
import { LyricSettingsContent } from "@/screens/LyricSettingsScreen";
import { AccountSettingsScreen } from "@/screens/settings/AccountSettingsScreen";
import { AppearanceSettingsScreen } from "@/screens/settings/AppearanceSettingsScreen";
import { PlaybackSettingsScreen } from "@/screens/settings/PlaybackSettingsScreen";
import { SourcesSettingsScreen } from "@/screens/settings/SourcesSettingsScreen";
import { LyricsSettingsScreen } from "@/screens/settings/LyricsSettingsScreen";
import { SyncSettingsScreen } from "@/screens/settings/SyncSettingsScreen";
import { DataSettingsScreen } from "@/screens/settings/DataSettingsScreen";
import { AboutSettingsScreen } from "@/screens/settings/AboutSettingsScreen";
import { breakpoints } from "@/theme/tokens";

const Drawer = createDrawerNavigator<SettingsDrawerParamList>();
const Stack = createNativeStackNavigator<SettingsStackParamList>();

function SettingsCategories() {
  const { width } = useWindowDimensions();
  const isTablet = width >= breakpoints.tablet;

  return (
    <Drawer.Navigator
      initialRouteName={DEFAULT_SETTINGS_CATEGORY}
      drawerContent={(props) => <SettingsDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: isTablet ? "permanent" : "front",
        swipeEnabled: false,
        drawerStyle: { width: isTablet ? 188 : Math.min(300, width * 0.82) },
        overlayColor: "rgba(0, 0, 0, 0.38)",
        lazy: true,
      }}
    >
      <Drawer.Screen name="Account" component={AccountSettingsScreen} />
      <Drawer.Screen name="Appearance" component={AppearanceSettingsScreen} />
      <Drawer.Screen name="Playback" component={PlaybackSettingsScreen} />
      <Drawer.Screen name="Sources" component={SourcesSettingsScreen} />
      <Drawer.Screen name="Lyrics" component={LyricsSettingsScreen} />
      <Drawer.Screen name="Sync" component={SyncSettingsScreen} />
      <Drawer.Screen name="Data" component={DataSettingsScreen} />
      <Drawer.Screen name="About" component={AboutSettingsScreen} />
    </Drawer.Navigator>
  );
}

export function SettingsNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Categories" component={SettingsCategories} />
      <Stack.Screen name="Login">
        {({ navigation }) => <LoginScreen onSuccess={() => navigation.goBack()} />}
      </Stack.Screen>
      <Stack.Screen name="WebDav">
        {({ navigation }) => <WebDavSyncScreen onBack={() => navigation.goBack()} />}
      </Stack.Screen>
      <Stack.Screen name="CustomSources">
        {({ navigation }) => <CustomSourceScreen onBack={() => navigation.goBack()} />}
      </Stack.Screen>
      <Stack.Screen name="LyricDetail">
        {({ navigation }) => <LyricSettingsContent onBack={() => navigation.goBack()} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
