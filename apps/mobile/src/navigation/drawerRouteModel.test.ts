import { describe, expect, it } from "vitest";
import { APP_SETTINGS_TAB, APP_TABS } from "@/services/appNavigation";
import {
  drawerRouteToTabId,
  getActiveDrawerRouteName,
  tabIdToDrawerRoute,
} from "./drawerRouteModel";

describe("drawer route model", () => {
  it.each([
    ["home", "Home"],
    ["search", "Search"],
    ["daily", "Daily"],
    ["fm", "FM"],
    ["playlists", "Playlists"],
    ["downloads", "Downloads"],
    ["local", "Local"],
    ["settings", "Settings"],
  ] as const)("maps %s to %s in both directions", (tab, route) => {
    expect(tabIdToDrawerRoute(tab)).toBe(route);
    expect(drawerRouteToTabId(route)).toBe(tab);
  });

  it("covers every visible sidebar item", () => {
    const ids = [...APP_TABS, APP_SETTINGS_TAB].map((item) => item.id);
    expect(ids.map(tabIdToDrawerRoute)).toEqual([
      "Home",
      "Search",
      "Daily",
      "FM",
      "Playlists",
      "Downloads",
      "Local",
      "Settings",
    ]);
  });

  it("maps the legacy Library route to playlists without exposing a second tab", () => {
    expect(drawerRouteToTabId("Library")).toBe("playlists");
  });

  it("reads the active drawer route", () => {
    const state = { index: 1, routes: [{ name: "Home" }, { name: "Search" }] };
    expect(getActiveDrawerRouteName(state)).toBe("Search");
  });

  it("rejects a missing active drawer route", () => {
    const state = { index: 1, routes: [{ name: "Home" }] };
    expect(() => getActiveDrawerRouteName(state)).toThrowError(
      "Active drawer route is missing at index 1",
    );
  });
});
