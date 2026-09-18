import { describe, expect, it } from "vitest";
import { createListenTracker } from "./listen-threshold";

describe("ListenTracker", () => {
  it("播满 120s 触发", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    for (let i = 0; i < 120; i++) t.accumulate(1, true);
    expect(t.shouldRecord()).toBe(true);
    expect(t.checkAndRecord()).toBe(true);
    // 已经消费过，第二次 checkAndRecord 返回 false
    expect(t.checkAndRecord()).toBe(false);
  });

  it("播满 50% 触发（80s 曲播 40s）", () => {
    const t = createListenTracker({ durationSeconds: 80 });
    for (let i = 0; i < 40; i++) t.accumulate(1, true);
    expect(t.shouldRecord()).toBe(true);
    expect(t.checkAndRecord()).toBe(true);
  });

  it("只播 60s 不满足 300s 曲的 50% 或 120s 阈值", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    for (let i = 0; i < 60; i++) t.accumulate(1, true);
    expect(t.shouldRecord()).toBe(false);
    expect(t.checkAndRecord()).toBe(false);
  });

  it("暂停不累加", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    t.accumulate(1, false);
    t.accumulate(1, false);
    expect(t.getAccumulated()).toBe(0);
    expect(t.shouldRecord()).toBe(false);
  });

  it("seek 前进 delta >= 2s 不累加（防拖进度条刷满）", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    t.accumulate(200, true);
    expect(t.getAccumulated()).toBe(0);
    expect(t.shouldRecord()).toBe(false);
  });

  it("seek 后退 delta <= 0s 不累加", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    t.accumulate(1, true);
    t.accumulate(-10, true);
    t.accumulate(0, true);
    expect(t.getAccumulated()).toBe(1);
  });

  it("reset 后重新计数", () => {
    const t = createListenTracker({ durationSeconds: 300 });
    for (let i = 0; i < 150; i++) t.accumulate(1, true);
    expect(t.shouldRecord()).toBe(true);
    t.reset();
    expect(t.getAccumulated()).toBe(0);
    expect(t.isRecorded()).toBe(false);
    expect(t.shouldRecord()).toBe(false);
  });

  it("自定义 minSeconds 与 ratio", () => {
    const t = createListenTracker({ durationSeconds: 200, minSeconds: 60, ratio: 0.8 });
    for (let i = 0; i < 60; i++) t.accumulate(1, true);
    expect(t.shouldRecord()).toBe(true);
  });
});
