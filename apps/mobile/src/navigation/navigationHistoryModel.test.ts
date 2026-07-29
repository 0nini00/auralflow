import { describe, expect, it } from "vitest";

import {
  applyNavigationState,
  createMainNavigationTarget,
  createNavigationHistory,
  createRootNavigationTarget,
  moveBackward,
  moveForward,
  navigationObservationsEqual,
  navigationReplayTargetsEqual,
  navigationTargetsEqual,
  recordNavigation,
  type NavigationTarget,
} from "./navigationHistoryModel";

describe("navigation history model", () => {
  it("truncates forward entries after a new navigation", () => {
    let history = createNavigationHistory("Home");
    history = recordNavigation(history, "Search");
    history = recordNavigation(history, "ArtistDetail");
    history = moveBackward(history).history;
    history = recordNavigation(history, "Settings");

    expect(history).toEqual({ entries: ["Home", "Search", "Settings"], index: 2 });
  });

  it("moves backward and forward without duplicating entries", () => {
    let history = createNavigationHistory("Home");
    history = recordNavigation(history, "Search");

    const back = moveBackward(history);
    const forward = moveForward(back.history);

    expect(back.value).toBe("Home");
    expect(forward.value).toBe("Search");
    expect(forward.history.entries).toEqual(["Home", "Search"]);
  });

  it("does not move beyond either boundary", () => {
    const initial = createNavigationHistory("Home");
    const back = moveBackward(initial);
    const forward = moveForward(initial);

    expect(back).toEqual({ history: initial, value: null });
    expect(forward).toEqual({ history: initial, value: null });
  });

  it("records an explicit Home navigation and truncates the forward branch", () => {
    const home = createMainNavigationTarget("Home");
    const search = createMainNavigationTarget("Search");
    const artist = createRootNavigationTarget("ArtistDetail", { artist: { id: "1" } });
    let history = createNavigationHistory<NavigationTarget>(home);
    history = recordNavigation(history, search, navigationTargetsEqual);
    history = recordNavigation(history, artist, navigationTargetsEqual);
    history = moveBackward(history).history;

    const transition = applyNavigationState(
      history,
      home,
      null,
      navigationObservationsEqual,
      navigationReplayTargetsEqual,
    );

    expect(transition).toEqual({
      history: { entries: [home, search, home], index: 2 },
      pendingReplay: null,
    });
  });

  it("keeps pending replay through mismatches and clears it only after a match", () => {
    const home = createMainNavigationTarget("Home");
    const search = createMainNavigationTarget("Search", { initialKeyword: "foo" });
    const artist = createRootNavigationTarget("ArtistDetail", { artist: { id: "1" } });
    let history = createNavigationHistory<NavigationTarget>(home);
    history = recordNavigation(history, search, navigationTargetsEqual);
    history = recordNavigation(history, artist, navigationTargetsEqual);
    const back = moveBackward(history);

    const rootMismatch = applyNavigationState(
      back.history,
      createRootNavigationTarget("Download"),
      back.value,
      navigationObservationsEqual,
      navigationReplayTargetsEqual,
    );
    const mainMismatch = applyNavigationState(
      rootMismatch.history,
      createMainNavigationTarget("Settings"),
      rootMismatch.pendingReplay,
      navigationObservationsEqual,
      navigationReplayTargetsEqual,
    );
    const replayed = applyNavigationState(
      mainMismatch.history,
      createMainNavigationTarget("Search"),
      mainMismatch.pendingReplay,
      navigationObservationsEqual,
      navigationReplayTargetsEqual,
    );

    expect(rootMismatch).toEqual({ history: back.history, pendingReplay: search });
    expect(mainMismatch).toEqual({ history: back.history, pendingReplay: search });
    expect(replayed).toEqual({ history: back.history, pendingReplay: null });
    expect(replayed.history).toEqual({ entries: [home, search, artist], index: 1 });
  });

  it("keeps Main params and separates searches with different params", () => {
    const first = createMainNavigationTarget("Search", { initialKeyword: "first" });
    const second = createMainNavigationTarget("Search", { initialKeyword: "second" });
    let history = createNavigationHistory<NavigationTarget>(first);

    expect(first).toEqual({
      kind: "main",
      name: "Search",
      params: { initialKeyword: "first" },
    });
    expect(navigationTargetsEqual(first, second)).toBe(false);

    history = recordNavigation(history, second, navigationTargetsEqual);
    expect(history).toEqual({ entries: [first, second], index: 1 });
  });

  it("treats consumed empty Main params as the current observation", () => {
    const search = createMainNavigationTarget("Search", { initialKeyword: "foo" });
    const consumed = createMainNavigationTarget("Search");
    const history = createNavigationHistory<NavigationTarget>(search);

    const transition = applyNavigationState(
      history,
      consumed,
      null,
      navigationObservationsEqual,
      navigationReplayTargetsEqual,
    );

    expect(navigationTargetsEqual(search, consumed)).toBe(false);
    expect(navigationObservationsEqual(search, consumed)).toBe(true);
    expect(transition).toEqual({ history, pendingReplay: null });
  });

  it("compares Root params by value and distinguishes different params", () => {
    const first = createRootNavigationTarget("ArtistDetail", { artist: { id: "1" } });
    const same = createRootNavigationTarget("ArtistDetail", { artist: { id: "1" } });
    const different = createRootNavigationTarget("ArtistDetail", { artist: { id: "2" } });
    let history = createNavigationHistory(first);

    expect(navigationTargetsEqual(first, same)).toBe(true);
    expect(navigationTargetsEqual(first, different)).toBe(false);

    history = recordNavigation(history, same, navigationTargetsEqual);
    history = recordNavigation(history, different, navigationTargetsEqual);
    expect(history).toEqual({ entries: [first, different], index: 1 });
  });
});
