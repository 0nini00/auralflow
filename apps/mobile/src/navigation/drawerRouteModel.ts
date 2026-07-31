import type { MainDrawerParamList } from "@/navigation/types";
import type { VisibleTabId } from "@/services/appNavigation";

const TAB_TO_ROUTE: Record<VisibleTabId, keyof MainDrawerParamList> = {
  home: "MainTabs",
  library: "MainTabs",
  myMusic: "MainTabs",
  search: "MainTabs",
  settings: "Settings",
};

interface DrawerRouteState {
  index: number;
  routes: ReadonlyArray<{ name: string }>;
}

export function getActiveDrawerRouteName(
  state: DrawerRouteState,
): keyof MainDrawerParamList {
  const route = state.routes[state.index];
  if (!route) {
    throw new Error(`Active drawer route is missing at index ${state.index}`);
  }
  return route.name as keyof MainDrawerParamList;
}

export function tabIdToDrawerRoute(id: VisibleTabId): keyof MainDrawerParamList {
  return TAB_TO_ROUTE[id];
}

export function drawerRouteToTabId(route: keyof MainDrawerParamList): VisibleTabId {
  if (route === "MainTabs") return "home";
  if (route === "Settings") return "settings";
  return "home";
}
