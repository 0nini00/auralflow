import { describe, expect, it } from "vitest";
import {
  buildImmersivePlayModeControl,
  getMobilePlayModeLabel,
  getNextMobilePlayMode,
  getTrackPlayerRepeatModeForPlayMode,
  MOBILE_PLAY_MODE_SEQUENCE,
} from "@/services/mobilePlayModeModel";

describe("mobile play mode model", () => {
  it("matches desktop play mode order including sequence mode", () => {
    expect(MOBILE_PLAY_MODE_SEQUENCE).toEqual(["list", "single", "shuffle", "sequence"]);
    expect(getNextMobilePlayMode("list")).toBe("single");
    expect(getNextMobilePlayMode("single")).toBe("shuffle");
    expect(getNextMobilePlayMode("shuffle")).toBe("sequence");
    expect(getNextMobilePlayMode("sequence")).toBe("list");
  });

  it("builds user-facing labels", () => {
    expect(getMobilePlayModeLabel("list")).toBe("列表循环");
    expect(getMobilePlayModeLabel("single")).toBe("单曲循环");
    expect(getMobilePlayModeLabel("shuffle")).toBe("随机播放");
    expect(getMobilePlayModeLabel("sequence")).toBe("顺序播放");
  });

  it("maps play modes to TrackPlayer repeat modes", () => {
    expect(getTrackPlayerRepeatModeForPlayMode("single")).toBe("track");
    expect(getTrackPlayerRepeatModeForPlayMode("list")).toBe("queue");
    expect(getTrackPlayerRepeatModeForPlayMode("shuffle")).toBe("queue");
    expect(getTrackPlayerRepeatModeForPlayMode("sequence")).toBe("off");
  });

  it("builds immersive lyrics play mode control state", () => {
    expect(buildImmersivePlayModeControl("list")).toEqual({
      label: "列表循环",
      iconLabel: "循环",
      active: true,
    });
    expect(buildImmersivePlayModeControl("single")).toEqual({
      label: "单曲循环",
      iconLabel: "单曲",
      active: true,
    });
    expect(buildImmersivePlayModeControl("shuffle")).toEqual({
      label: "随机播放",
      iconLabel: "随机",
      active: true,
    });
    expect(buildImmersivePlayModeControl("sequence")).toEqual({
      label: "顺序播放",
      iconLabel: "顺序",
      active: false,
    });
  });
});
