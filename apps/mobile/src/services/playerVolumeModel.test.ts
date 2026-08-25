import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOLUME,
  getNextMuteState,
  getNextVolumeState,
  normalizePersistedVolumeState,
} from "./playerVolumeModel";

describe("playerVolumeModel", () => {
  it("静音时保存当前非零音量，取消静音时恢复", () => {
    const muted = getNextMuteState({ volume: 0.6, previousVolume: 0.8, isMuted: false });
    const restored = getNextMuteState(muted);

    expect(muted).toEqual({ volume: 0, previousVolume: 0.6, isMuted: true });
    expect(restored).toEqual({ volume: 0.6, previousVolume: 0.6, isMuted: false });
  });

  it("设置零音量会静音但保留上次非零音量", () => {
    expect(getNextVolumeState(
      { volume: 0.7, previousVolume: 0.7, isMuted: false },
      0,
    )).toEqual({ volume: 0, previousVolume: 0.7, isMuted: true });
  });

  it("无效持久化值恢复为默认音量", () => {
    expect(normalizePersistedVolumeState({ volume: Number.NaN })).toEqual({
      volume: DEFAULT_VOLUME,
      previousVolume: DEFAULT_VOLUME,
      isMuted: false,
    });
  });
});
