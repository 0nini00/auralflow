import { describe, expect, it } from "vitest";
import {
  buildImmersivePlaybackRateModel,
  clampPlaybackRate,
  DEFAULT_PLAYBACK_RATE,
} from "./playerRateModel";

describe("playerRateModel", () => {
  it("将倍速限制在支持范围并处理非有限值", () => {
    expect(clampPlaybackRate(0.1)).toBe(0.5);
    expect(clampPlaybackRate(4)).toBe(2);
    expect(clampPlaybackRate(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PLAYBACK_RATE);
  });

  it("只标记当前倍速选项", () => {
    const model = buildImmersivePlaybackRateModel(1.25);

    expect(model.options.filter((option) => option.active)).toEqual([
      { value: 1.25, label: "1.25x", active: true },
    ]);
  });
});
