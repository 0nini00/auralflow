import { describe, expect, it } from "vitest";
import {
  getNextQueueNavigationState,
  getPreviousQueueNavigationState,
} from "./queueNavigationModel";

describe("queueNavigationModel", () => {
  it("顺序播放到队尾时停止，列表循环回到首曲", () => {
    expect(getNextQueueNavigationState({
      queueLength: 2,
      currentIndex: 1,
      playMode: "sequence",
      shuffleHistory: [],
    }).nextIndex).toBeNull();

    expect(getNextQueueNavigationState({
      queueLength: 2,
      currentIndex: 1,
      playMode: "list",
      shuffleHistory: [],
    }).nextIndex).toBe(0);
  });

  it("单曲随机队列保持当前索引", () => {
    expect(getNextQueueNavigationState({
      queueLength: 1,
      currentIndex: 0,
      playMode: "shuffle",
      shuffleHistory: [],
      random: () => 0.5,
    })).toEqual({
      nextIndex: 0,
      shuffleHistory: [0],
      playedIndices: [0],
    });
  });

  it("随机模式优先选择本轮未播放项", () => {
    const result = getNextQueueNavigationState({
      queueLength: 4,
      currentIndex: 1,
      playMode: "shuffle",
      shuffleHistory: [],
      playedIndices: [0, 1],
      random: () => 0,
    });

    expect(result.nextIndex).toBe(2);
    expect(result.playedIndices).toEqual([0, 1, 2]);
    expect(result.shuffleHistory).toEqual([1]);
  });

  it("播放超过三秒时上一首操作重播当前歌曲", () => {
    expect(getPreviousQueueNavigationState({
      queueLength: 3,
      currentIndex: 2,
      position: 3.1,
      playMode: "list",
      shuffleHistory: [],
    })).toEqual({
      previousIndex: 2,
      shouldRestartCurrent: true,
      shuffleHistory: [],
    });
  });
});
