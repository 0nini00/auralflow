import { describe, expect, it } from "vitest";
import {
  getNextQueueNavigationState,
  getPreviousQueueNavigationState,
} from "@/services/queueNavigationModel";

describe("queue navigation model", () => {
  it("records current index when shuffle picks the next song", () => {
    const result = getNextQueueNavigationState({
      queueLength: 4,
      currentIndex: 1,
      playMode: "shuffle",
      shuffleHistory: [],
      random: () => 0,
    });

    expect(result).toEqual({
      nextIndex: 0,
      shuffleHistory: [1],
    });
  });

  it("does not pick the current song when shuffle has alternatives", () => {
    const result = getNextQueueNavigationState({
      queueLength: 3,
      currentIndex: 0,
      playMode: "shuffle",
      shuffleHistory: [],
      random: () => 0,
    });

    expect(result.nextIndex).toBe(1);
    expect(result.shuffleHistory).toEqual([0]);
  });

  it("uses shuffle history for previous navigation", () => {
    const result = getPreviousQueueNavigationState({
      queueLength: 5,
      currentIndex: 3,
      position: 1,
      playMode: "shuffle",
      shuffleHistory: [0, 2],
    });

    expect(result).toEqual({
      previousIndex: 2,
      shouldRestartCurrent: false,
      shuffleHistory: [0],
    });
  });

  it("restarts current song instead of going previous after playback has progressed", () => {
    const result = getPreviousQueueNavigationState({
      queueLength: 5,
      currentIndex: 3,
      position: 4,
      playMode: "shuffle",
      shuffleHistory: [0, 2],
    });

    expect(result).toEqual({
      previousIndex: 3,
      shouldRestartCurrent: true,
      shuffleHistory: [0, 2],
    });
  });
});
