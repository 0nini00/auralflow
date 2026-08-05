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
      playedIndices: [0],
    });
  });

  it("does not repeat played indices within a shuffle round", () => {
    // 4 首歌，当前 0，本轮已播 [1,2]。排除当前 0 → allExceptCurrent [1,2,3]，
    // 再去掉已播 {1,2} → 唯一候选 [3]，必抽到 3，playedList 累加为 [1,2,3]。
    const state = getNextQueueNavigationState({
      queueLength: 4,
      currentIndex: 0,
      playMode: "shuffle",
      shuffleHistory: [],
      playedIndices: [1, 2],
      random: () => 0,
    });
    expect(state.nextIndex).toBe(3);
    expect(state.playedIndices).toEqual([1, 2, 3]);
  });

  it("resets the played list when a shuffle round is exhausted", () => {
    // 4 首歌，当前 3，本轮已播 [0,1,2]。排除当前 3 → allExceptCurrent [0,1,2]，
    // 全在已播集合里 → 候选清空，触发新一轮：候选重置为 [0,1,2]，playedList 重置为 [当前 3]。
    // random 取首个 → 0；playedList 变为 [3, 0]。
    const state = getNextQueueNavigationState({
      queueLength: 4,
      currentIndex: 3,
      playMode: "shuffle",
      shuffleHistory: [],
      playedIndices: [0, 1, 2],
      random: () => 0,
    });
    expect(state.nextIndex).toBe(0);
    expect(state.playedIndices).toEqual([3, 0]);
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
