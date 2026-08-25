import { describe, expect, it } from "vitest";
import { getPlaybackSnapshotSaveTrigger, isPlaybackSnapshotEmpty } from "./playbackSnapshotModel";

const BASE = {
  currentSong: { source: "wy", id: "1" },
  queue: [{ source: "wy", id: "1" }],
  currentIndex: 0,
  shuffleHistory: [],
  playMode: "list",
  playbackRate: 1,
  volume: 1,
  previousVolume: 1,
  isMuted: false,
  playbackContext: { type: "queue" },
  position: 0,
  isPlaying: true,
};

describe("playbackSnapshotModel", () => {
  it("跨越十秒进度桶时保存", () => {
    expect(getPlaybackSnapshotSaveTrigger(
      { ...BASE, position: 20.1 },
      { ...BASE, position: 19.9 },
    )).toBe("progress");
  });

  it("暂停时立即保存", () => {
    expect(getPlaybackSnapshotSaveTrigger(
      { ...BASE, isPlaying: false },
      { ...BASE, isPlaying: true },
    )).toBe("pause");
  });

  it("结构变化时保存", () => {
    expect(getPlaybackSnapshotSaveTrigger(
      { ...BASE, currentIndex: 1 },
      BASE,
    )).toBe("structural");
  });

  it("无变化时不保存", () => {
    expect(getPlaybackSnapshotSaveTrigger(BASE, BASE)).toBe("none");
  });

  it("空队列空当前曲判定为空快照", () => {
    expect(isPlaybackSnapshotEmpty({ currentSong: null, queue: [] })).toBe(true);
  });
});
