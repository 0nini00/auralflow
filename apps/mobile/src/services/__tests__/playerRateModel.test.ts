import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYBACK_RATE,
  SUPPORTED_PLAYBACK_RATES,
  buildImmersivePlaybackRateModel,
  clampPlaybackRate,
  formatPlaybackRate,
} from "@/services/playerRateModel";

describe("player rate model", () => {
  it("defines the mobile playback rate options shown in the player", () => {
    expect(DEFAULT_PLAYBACK_RATE).toBe(1);
    expect(SUPPORTED_PLAYBACK_RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });

  it("clamps playback rate to the supported mobile TrackPlayer range", () => {
    expect(clampPlaybackRate(0)).toBe(0.5);
    expect(clampPlaybackRate(0.75)).toBe(0.75);
    expect(clampPlaybackRate(3)).toBe(2);
    expect(clampPlaybackRate(Number.NaN)).toBe(DEFAULT_PLAYBACK_RATE);
  });

  it("formats playback rate labels consistently", () => {
    expect(formatPlaybackRate(1)).toBe("1x");
    expect(formatPlaybackRate(1.25)).toBe("1.25x");
  });

  it("builds immersive lyrics playback rate controls", () => {
    expect(buildImmersivePlaybackRateModel(1.25)).toEqual({
      title: "播放倍速",
      triggerLabel: "倍速 1.25x",
      closeLabel: "关闭",
      options: [
        { value: 0.5, label: "0.5x", active: false },
        { value: 0.75, label: "0.75x", active: false },
        { value: 1, label: "1x", active: false },
        { value: 1.25, label: "1.25x", active: true },
        { value: 1.5, label: "1.5x", active: false },
        { value: 2, label: "2x", active: false },
      ],
    });
  });
});
