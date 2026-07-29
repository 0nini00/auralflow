import React from "react";
import { useWindowDimensions } from "react-native";
import {
  createDrawerNavigator,
  type DrawerContentComponentProps,
} from "@react-navigation/drawer";

import { AppSidebar } from "@/components/AppSidebar";
import { HomeScreen } from "@/screens/HomeScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { DailyRecommendScreen } from "@/screens/DailyRecommendScreen";
import { PersonalFmScreen } from "@/screens/PersonalFmScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { DownloadScreen } from "@/screens/DownloadScreen";
import { SettingsNavigator } from "@/navigation/SettingsNavigator";
import {
  drawerRouteToTabId,
  getActiveDrawerRouteName,
  tabIdToDrawerRoute,
} from "@/navigation/drawerRouteModel";
import { openPlayerScreen } from "@/navigation/navigationRef";
import type { MainDrawerParamList } from "@/navigation/types";
import {
  getLibraryNavigationTarget,
  getLibrarySectionForRoute,
} from "@/services/libraryRouteModel";
import type { LibrarySection } from "@/services/librarySectionModel";

const Drawer = createDrawerNavigator<MainDrawerParamList>();

function navigateToLibrarySection(
  navigation: { navigate: (...args: never[]) => void },
  section: LibrarySection,
) {
  const target = getLibraryNavigationTarget(section);
  navigation.navigate(target.name as never, target.params as never);
}

function DrawerContent(props: DrawerContentComponentProps) {
  const routeName = getActiveDrawerRouteName(props.state);
  const activeTab = drawerRouteToTabId(routeName);

  return (
    <AppSidebar
      activeTab={activeTab}
      onSelect={(id) => {
        props.navigation.closeDrawer();
        props.navigation.navigate(tabIdToDrawerRoute(id));
      }}
    />
  );
}

export function MainDrawerNavigator() {
  const { width } = useWindowDimensions();
  const sidebarWidth = Math.min(300, Math.round(width * 0.78));

  return (
    <Drawer.Navigator
      initialRouteName="Home"
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: "front",
        drawerStyle: { width: sidebarWidth },
        overlayColor: "rgba(0, 0, 0, 0.45)",
        // React Navigation handles Android back/system back while the Drawer is open:
        // close the Drawer first; only a closed Drawer delegates back to the screen stack.
        swipeEnabled: true,
        // 收敛边缘响应区,只在左侧 24px 内触发,避免与列表水平滚动/横向轮播误碰
        swipeEdgeWidth: 24,
      }}
    >
      <Drawer.Screen name="Home">
        {({ navigation }) => (
          <HomeScreen
            onNavigateToPlayer={openPlayerScreen}
            onNavigateToSearch={() => navigation.navigate("Search")}
            onNavigateToFm={() => navigation.navigate("FM")}
            onNavigateToHistory={() =>
              navigation.navigate("Library", { section: "history" })
            }
          />
        )}
      </Drawer.Screen>

      <Drawer.Screen name="Search">
        {({ navigation, route }) => (
          <SearchScreen
            onNavigateToPlayer={openPlayerScreen}
            initialKeyword={route.params?.initialKeyword ?? null}
            onInitialKeywordConsumed={() =>
              navigation.setParams({ initialKeyword: undefined })
            }
            initialDetailRoute={route.params?.initialDetailRoute ?? null}
            onInitialDetailRouteConsumed={() =>
              navigation.setParams({ initialDetailRoute: undefined })
            }
          />
        )}
      </Drawer.Screen>

      <Drawer.Screen name="Daily">
        {({ navigation }) => (
          <DailyRecommendScreen
            onNavigateToPlayer={openPlayerScreen}
            onBack={() => navigation.navigate("Home")}
          />
        )}
      </Drawer.Screen>

      <Drawer.Screen name="FM">
        {() => <PersonalFmScreen onNavigateToPlayer={openPlayerScreen} />}
      </Drawer.Screen>

      <Drawer.Screen name="Playlists">
        {({ navigation }) => (
          <LibraryScreen
            onNavigateToPlayer={openPlayerScreen}
            activeSection={getLibrarySectionForRoute("Playlists")}
            onSelectSection={(section) =>
              navigateToLibrarySection(navigation, section)
            }
          />
        )}
      </Drawer.Screen>

      <Drawer.Screen name="Local">
        {({ navigation }) => (
          <LibraryScreen
            onNavigateToPlayer={openPlayerScreen}
            activeSection={getLibrarySectionForRoute("Local")}
            onSelectSection={(section) =>
              navigateToLibrarySection(navigation, section)
            }
          />
        )}
      </Drawer.Screen>

      <Drawer.Screen name="Downloads">
        {() => <DownloadScreen onNavigateToPlayer={openPlayerScreen} />}
      </Drawer.Screen>

      <Drawer.Screen name="Library">
        {({ navigation, route }) => (
          <LibraryScreen
            onNavigateToPlayer={openPlayerScreen}
            activeSection={getLibrarySectionForRoute("Library", route.params)}
            onSelectSection={(section) =>
              navigateToLibrarySection(navigation, section)
            }
          />
        )}
      </Drawer.Screen>

      <Drawer.Screen name="Settings" component={SettingsNavigator} />
    </Drawer.Navigator>
  );
}
