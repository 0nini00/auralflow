import type { MainDrawerParamList } from "@/navigation/types";
import type { VisibleTabId } from "@/services/appNavigation";

const TAB_TO_ROUTE: Record<VisibleTabId, keyof MainDrawerParamList> = {
  home: "Home",
  search: "Search",
  daily: "Daily",
  fm: "FM",
  playlists: "Playlists",
  downloads: "Downloads",
  local: "Local",
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
  if (route.name === "Library") return route.name;

  const match = Object.values(TAB_TO_ROUTE).find((value) => value === route.name);
  if (!match) throw new Error(`Unknown drawer route: ${route.name}`);
  return match;
}

export function tabIdToDrawerRoute(id: VisibleTabId): keyof MainDrawerParamList {
  return TAB_TO_ROUTE[id];
}

export function drawerRouteToTabId(route: keyof MainDrawerParamList): VisibleTabId {
  if (route === "Library") return "playlists";
  const match = Object.entries(TAB_TO_ROUTE).find(([, value]) => value === route);
  if (!match) throw new Error(`Unknown drawer route: ${route}`);
  return match[0] as VisibleTabId;
}
