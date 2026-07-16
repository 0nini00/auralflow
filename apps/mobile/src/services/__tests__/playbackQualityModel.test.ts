import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYBACK_QUALITY,
  PLAYBACK_QUALITY_OPTIONS,
  getPlaybackQualityFallbacks,
  getPlaybackQualityLabel,
  normalizePlaybackQuality,
  resolveEffectivePlaybackQuality,
} from "@/services/playbackQualityModel";

describe("playback quality model", () => {
  it("defines the mobile playback quality options", () => {
    expect(DEFAULT_PLAYBACK_QUALITY).toBe("320k");
    expect(PLAYBACK_QUALITY_OPTIONS.map((option) => option.value)).toEqual([
      "128k",
      "192k",
      "320k",
      "flac",
      "flac24bit",
    ]);
  });

  it("normalizes persisted quality values", () => {
    expect(normalizePlaybackQuality("flac")).toBe("flac");
    expect(normalizePlaybackQuality("hires")).toBe("flac24bit");
    expect(normalizePlaybackQuality("unknown")).toBe(DEFAULT_PLAYBACK_QUALITY);
    expect(normalizePlaybackQuality(null)).toBe(DEFAULT_PLAYBACK_QUALITY);
  });

  it("prefers the user setting over song metadata for online playback", () => {
    expect(resolveEffectivePlaybackQuality("128k", "flac")).toBe("flac");
    expect(resolveEffectivePlaybackQuality("flac", undefined)).toBe("flac");
    expect(resolveEffectivePlaybackQuality(undefined, undefined)).toBe(DEFAULT_PLAYBACK_QUALITY);
  });

  it("returns stable labels for settings UI", () => {
    expect(getPlaybackQualityLabel("320k")).toBe("高品质 320K");
    expect(getPlaybackQualityLabel("flac24bit")).toBe("Hi-Res");
  });

  it("expands quality into a descending fallback ladder", () => {
    expect(getPlaybackQualityFallbacks("flac24bit")).toEqual([
      "flac24bit",
      "flac",
      "320k",
      "192k",
      "128k",
    ]);
    expect(getPlaybackQualityFallbacks("320k")).toEqual(["320k", "192k", "128k"]);
    expect(getPlaybackQualityFallbacks("128k")).toEqual(["128k"]);
  });

  it("falls back to the default ladder for unknown quality", () => {
    expect(getPlaybackQualityFallbacks("unknown")).toEqual(["320k", "192k", "128k"]);
    expect(getPlaybackQualityFallbacks(null)).toEqual(["320k", "192k", "128k"]);
  });
});
