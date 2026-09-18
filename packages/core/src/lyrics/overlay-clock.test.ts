import { describe, expect, it } from "vitest";
import {
  scheduleOverlayTick,
  shouldCalibrateClock,
} from "./overlay-clock";

describe("scheduleOverlayTick", () => {
  const lines = [
    { time: 0, text: "intro" },
    { time: 5, text: "line 1" },
    { time: 10, text: "line 2" },
  ];

  it("position 0 时定位第 0 行，下个行在 5s 后", () => {
    const result = scheduleOverlayTick(lines, 0, 1);
    expect(result.currentLineIndex).toBe(0);
    expect(result.nextDelayMs).toBe(5000);
  });

  it("position 6.5 时定位第 1 行，下个行在 3.5s 后", () => {
    const result = scheduleOverlayTick(lines, 6.5, 1);
    expect(result.currentLineIndex).toBe(1);
    expect(result.nextDelayMs).toBeCloseTo(3500, -1);
  });

  it("rate=2 时延迟减半", () => {
    const result = scheduleOverlayTick(lines, 6.5, 2);
    expect(result.nextDelayMs).toBeCloseTo(1750, -1);
  });

  it("已到末行时返回 null delay", () => {
    const result = scheduleOverlayTick(lines, 100, 1);
    expect(result.currentLineIndex).toBe(2);
    expect(result.nextDelayMs).toBe(null);
  });

  it("空歌词返回 -1 行且无延迟", () => {
    const result = scheduleOverlayTick([], 0, 1);
    expect(result.currentLineIndex).toBe(-1);
    expect(result.nextDelayMs).toBe(null);
  });

  it("position 在首行之前时，返回 -1 行且等待首行起点", () => {
    const linesWithLead = [
      { time: 4, text: "first line" },
      { time: 8, text: "second line" },
    ];
    const result = scheduleOverlayTick(linesWithLead, 1, 1);
    expect(result.currentLineIndex).toBe(-1);
    expect(result.nextDelayMs).toBe(3000);
  });

  it("非正数 rate 兜底为 1", () => {
    const result = scheduleOverlayTick(lines, 0, 0);
    expect(result.nextDelayMs).toBe(5000);
  });
});

describe("shouldCalibrateClock", () => {
  it("前台超过 5s 需要校准", () => {
    expect(shouldCalibrateClock(6000, true)).toBe(true);
  });

  it("前台不足 5s 不需要", () => {
    expect(shouldCalibrateClock(3000, true)).toBe(false);
  });

  it("后台不需要校准（时钟自走）", () => {
    expect(shouldCalibrateClock(999999, false)).toBe(false);
  });
});
