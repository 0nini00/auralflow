import { describe, expect, it } from "vitest";
import {
  buildImmersiveVolumeControlModel,
  DEFAULT_VOLUME,
  clampPlayerVolume,
  getNextMuteState,
  normalizePersistedVolumeState,
  type PlayerVolumeState,
} from "@/services/playerVolumeModel";

describe("player volume model", () => {
  it("clamps volume to the TrackPlayer supported 0..1 range", () => {
    expect(clampPlayerVolume(-0.25)).toBe(0);
    expect(clampPlayerVolume(0.35)).toBe(0.35);
    expect(clampPlayerVolume(2)).toBe(1);
    expect(clampPlayerVolume(Number.NaN)).toBe(DEFAULT_VOLUME);
  });

  it("mutes without forgetting the previous audible volume", () => {
    const current: PlayerVolumeState = {
      volume: 0.4,
      previousVolume: 0.8,
      isMuted: false,
    };

    expect(getNextMuteState(current)).toEqual({
      volume: 0,
      previousVolume: 0.4,
      isMuted: true,
    });
  });

  it("restores the previous audible volume when unmuting", () => {
    const current: PlayerVolumeState = {
      volume: 0,
      previousVolume: 0.35,
      isMuted: true,
    };

    expect(getNextMuteState(current)).toEqual({
      volume: 0.35,
      previousVolume: 0.35,
      isMuted: false,
    });
  });

  it("uses default volume when unmuting with no previous audible volume", () => {
    const current: PlayerVolumeState = {
      volume: 0,
      previousVolume: 0,
      isMuted: true,
    };

    expect(getNextMuteState(current)).toEqual({
      volume: DEFAULT_VOLUME,
      previousVolume: DEFAULT_VOLUME,
      isMuted: false,
    });
  });

  it("restores persisted volume and mute state safely", () => {
    expect(normalizePersistedVolumeState({ volume: 0.6, previousVolume: 0.7, isMuted: false })).toEqual({
      volume: 0.6,
      previousVolume: 0.7,
      isMuted: false,
    });
    expect(normalizePersistedVolumeState({ volume: 0.6, previousVolume: 0.7, isMuted: true })).toEqual({
      volume: 0,
      previousVolume: 0.7,
      isMuted: true,
    });
    expect(normalizePersistedVolumeState({ volume: Number.NaN, previousVolume: -1, isMuted: false })).toEqual({
      volume: DEFAULT_VOLUME,
      previousVolume: DEFAULT_VOLUME,
      isMuted: false,
    });
  });

  it("builds immersive lyrics volume controls", () => {
    expect(buildImmersiveVolumeControlModel(0.8, false)).toEqual({
      title: "音量",
      triggerLabel: "音量 80%",
      meta: "当前 80%",
      closeLabel: "关闭",
      muteLabel: "静音",
      muted: false,
      options: [
        { value: 0, label: "0%", active: false },
        { value: 0.25, label: "25%", active: false },
        { value: 0.5, label: "50%", active: false },
        { value: 0.8, label: "80%", active: true },
        { value: 1, label: "100%", active: false },
      ],
    });

    expect(buildImmersiveVolumeControlModel(0, true)).toEqual({
      title: "音量",
      triggerLabel: "静音 已静音",
      meta: "当前已静音",
      closeLabel: "关闭",
      muteLabel: "取消静音",
      muted: true,
      options: [
        { value: 0, label: "0%", active: false },
        { value: 0.25, label: "25%", active: false },
        { value: 0.5, label: "50%", active: false },
        { value: 0.8, label: "80%", active: false },
        { value: 1, label: "100%", active: false },
      ],
    });
  });
});
