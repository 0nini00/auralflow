import type { NavigationState, PartialState } from "@react-navigation/native";

type AnyNavigationState = NavigationState | PartialState<NavigationState>;

export interface AppShellNavigationState {
  activeRouteName?: string;
  canGoBack: boolean;
  showChrome: boolean;
}

export function getActiveRouteName(state?: AnyNavigationState): string | undefined {
  if (!state || state.routes.length === 0) return undefined;
  const route = state.routes[state.index ?? 0];
  const nested = route.state as AnyNavigationState | undefined;
  return getActiveRouteName(nested) ?? route.name;
}

export function deriveAppShellNavigationState(
  state?: AnyNavigationState,
): AppShellNavigationState {
  const activeRouteName = getActiveRouteName(state);
  return {
    activeRouteName,
    canGoBack: (state?.index ?? 0) > 0,
    showChrome: activeRouteName !== "Player",
  };
}
