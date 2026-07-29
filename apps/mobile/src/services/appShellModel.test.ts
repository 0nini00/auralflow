import { describe, expect, it } from "vitest";
import { deriveAppShellNavigationState } from "./appShellModel";

describe("app shell model", () => {
  it("reads the active nested drawer route", () => {
    const state = {
      index: 0,
      routes: [{ name: "Main", state: { index: 1, routes: [{ name: "Home" }, { name: "Search" }] } }],
    };

    expect(deriveAppShellNavigationState(state as never)).toEqual({
      activeRouteName: "Search",
      canGoBack: false,
      showChrome: true,
    });
  });

  it("shows back navigation on root details", () => {
    const state = { index: 1, routes: [{ name: "Main" }, { name: "ArtistDetail" }] };
    expect(deriveAppShellNavigationState(state as never)).toMatchObject({
      activeRouteName: "ArtistDetail",
      canGoBack: true,
      showChrome: true,
    });
  });

  it("hides shell chrome for the immersive player", () => {
    const state = { index: 1, routes: [{ name: "Main" }, { name: "Player" }] };
    expect(deriveAppShellNavigationState(state as never).showChrome).toBe(false);
  });
});
