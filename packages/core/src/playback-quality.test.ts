import { describe, expect, it } from "vitest";
import {
  buildPlaybackQualityTiers,
  getPlaybackQualityFallbacks,
  getPlaybackQualityRank,
  getQualitiesAtOrAbove,
  normalizePlaybackQuality,
  raceForBestQuality,
} from "./playback-quality";

describe("normalizePlaybackQuality", () => {
  it("maps desktop and mobile aliases onto one ladder", () => {
    expect(normalizePlaybackQuality("high")).toBe("320k");
    expect(normalizePlaybackQuality("medium")).toBe("192k");
    expect(normalizePlaybackQuality("low")).toBe("128k");
    expect(normalizePlaybackQuality("hi-res")).toBe("flac24bit");
    expect(normalizePlaybackQuality("740")).toBe("flac");
    expect(normalizePlaybackQuality("999")).toBe("flac24bit");
  });

  it("falls back to default for unknown input", () => {
    expect(normalizePlaybackQuality(undefined)).toBe("320k");
    expect(normalizePlaybackQuality("nonsense")).toBe("320k");
  });
});

describe("getQualitiesAtOrAbove", () => {
  it("returns the floor plus every better tier, highest first", () => {
    expect(getQualitiesAtOrAbove("320k")).toEqual(["flac24bit", "flac", "320k"]);
    expect(getQualitiesAtOrAbove("flac24bit")).toEqual(["flac24bit"]);
    expect(getQualitiesAtOrAbove("128k")).toEqual([
      "flac24bit",
      "flac",
      "320k",
      "192k",
      "128k",
    ]);
  });
});

describe("buildPlaybackQualityTiers", () => {
  it("races everything at or above the floor first, then steps down one tier at a time", () => {
    expect(buildPlaybackQualityTiers("320k")).toEqual([
      ["flac24bit", "flac", "320k"],
      ["192k"],
      ["128k"],
    ]);
  });

  it("keeps 192k in the step-down chain (desktop used to skip it)", () => {
    const tiers = buildPlaybackQualityTiers("320k");
    expect(tiers.flat()).toContain("192k");
  });

  it("has no step-down rounds when the floor is already the lowest tier", () => {
    expect(buildPlaybackQualityTiers("128k")).toEqual([
      ["flac24bit", "flac", "320k", "192k", "128k"],
    ]);
  });
});

describe("getPlaybackQualityFallbacks", () => {
  it("walks down from the floor to the lowest tier", () => {
    expect(getPlaybackQualityFallbacks("flac")).toEqual(["flac", "320k", "192k", "128k"]);
    expect(getPlaybackQualityFallbacks("128k")).toEqual(["128k"]);
  });
});

function delayed<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function rejected(message: string, ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

const byQuality = { getQuality: (value: { quality: string }) => value.quality };

describe("raceForBestQuality", () => {
  it("upgrades to a better tier that lands inside the window", async () => {
    const result = await raceForBestQuality(
      [delayed({ quality: "320k" }, 5), delayed({ quality: "flac" }, 25)],
      { ...byQuality, upgradeWindowMs: 200, ceiling: "flac24bit" },
    );
    expect(result.quality).toBe("flac");
  });

  it("keeps the first result when nothing better arrives before the window closes", async () => {
    const result = await raceForBestQuality(
      [delayed({ quality: "320k" }, 5), delayed({ quality: "flac" }, 300)],
      { ...byQuality, upgradeWindowMs: 30, ceiling: "flac24bit" },
    );
    expect(result.quality).toBe("320k");
  });

  it("returns immediately once the ceiling tier succeeds", async () => {
    const started = Date.now();
    const result = await raceForBestQuality(
      [delayed({ quality: "flac" }, 5), delayed({ quality: "320k" }, 500)],
      { ...byQuality, upgradeWindowMs: 1000, ceiling: "flac" },
    );
    expect(result.quality).toBe("flac");
    expect(Date.now() - started).toBeLessThan(300);
  });

  it("ignores failures while any candidate can still succeed", async () => {
    const result = await raceForBestQuality(
      [rejected("source down", 5), delayed({ quality: "192k" }, 20)],
      { ...byQuality, upgradeWindowMs: 30, ceiling: "flac24bit" },
    );
    expect(result.quality).toBe("192k");
  });

  it("aggregates errors when every candidate fails", async () => {
    await expect(
      raceForBestQuality([rejected("a down", 5), rejected("b down", 10)], {
        ...byQuality,
        upgradeWindowMs: 30,
      }),
    ).rejects.toThrow(/a down \| b down/);
  });

  it("rejects an empty candidate list instead of hanging", async () => {
    await expect(
      raceForBestQuality([], { ...byQuality, upgradeWindowMs: 30 }),
    ).rejects.toThrow();
  });

  it("settles as soon as all candidates resolve, without waiting out the window", async () => {
    const started = Date.now();
    const result = await raceForBestQuality(
      [delayed({ quality: "192k" }, 5), delayed({ quality: "320k" }, 10)],
      { ...byQuality, upgradeWindowMs: 5000, ceiling: "flac24bit" },
    );
    expect(result.quality).toBe("320k");
    expect(Date.now() - started).toBeLessThan(300);
  });
});

describe("getPlaybackQualityRank", () => {
  it("orders the ladder so better tiers compare greater", () => {
    expect(getPlaybackQualityRank("flac24bit")).toBeGreaterThan(getPlaybackQualityRank("flac"));
    expect(getPlaybackQualityRank("320k")).toBeGreaterThan(getPlaybackQualityRank("192k"));
  });
});
