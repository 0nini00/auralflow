import { describe, expect, it } from "vitest";
import {
  getLibraryNavigationTarget,
  getLibrarySectionForRoute,
} from "@/services/libraryRouteModel";

describe("library route model", () => {
  it.each([
    ["Playlists", undefined, "playlists"],
    ["Local", undefined, "local"],
    ["Library", { section: "history" }, "history"],
    ["Library", { section: "bili" }, "bili"],
  ] as const)("maps %s to %s", (route, params, section) => {
    expect(getLibrarySectionForRoute(route, params)).toBe(section);
  });

  it("maps every library tab to a navigation target", () => {
    expect(getLibraryNavigationTarget("playlists")).toEqual({ name: "Playlists" });
    expect(getLibraryNavigationTarget("local")).toEqual({ name: "Local" });
    expect(getLibraryNavigationTarget("downloads")).toEqual({ name: "Downloads" });
    expect(getLibraryNavigationTarget("history")).toEqual({
      name: "Library",
      params: { section: "history" },
    });
    expect(getLibraryNavigationTarget("bili")).toEqual({
      name: "Library",
      params: { section: "bili" },
    });
  });
});
