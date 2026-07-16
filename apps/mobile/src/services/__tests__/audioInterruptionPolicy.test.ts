import { describe, expect, it } from "vitest";
import { getAudioInterruptionAction, normalizePauseOnExternalPlayback } from "@/services/audioInterruptionPolicy";

describe("audio interruption policy", () => {
  it("defaults to pausing for external playback interruptions", () => {
    expect(normalizePauseOnExternalPlayback(undefined)).toBe(true);
    expect(normalizePauseOnExternalPlayback(null)).toBe(true);
    expect(normalizePauseOnExternalPlayback(true)).toBe(true);
    expect(normalizePauseOnExternalPlayback(false)).toBe(false);
  });

  it("pauses when another app starts playback and pause policy is enabled", () => {
    expect(getAudioInterruptionAction({
      paused: true,
      permanent: false,
      pauseOnExternalPlayback: true,
      currentVolume: 0.8,
    })).toEqual({ type: "pause" });
  });

  it("ducks and restores volume when external playback is allowed", () => {
    expect(getAudioInterruptionAction({
      paused: true,
      permanent: false,
      pauseOnExternalPlayback: false,
      currentVolume: 0.8,
    })).toEqual({ type: "setVolume", volume: 0.2 });

    expect(getAudioInterruptionAction({
      paused: false,
      permanent: false,
      pauseOnExternalPlayback: false,
      currentVolume: 0.8,
    })).toEqual({ type: "setVolume", volume: 0.8 });
  });

  it("always pauses on permanent interruptions", () => {
    expect(getAudioInterruptionAction({
      paused: true,
      permanent: true,
      pauseOnExternalPlayback: false,
      currentVolume: 0.8,
    })).toEqual({ type: "pause" });
  });
});
