import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  normalizeDailyRecommendHistory,
  normalizeDailySongs,
} from "./dailyRecommendCache";

function song(id: string, overrides: Partial<MusicInfo> = {}): MusicInfo {
  return {
    id,
    name: `Song ${id}`,
    singer: "Singer",
    albumName: "Album",
    source: "wy",
    ...overrides,
  };
}

describe("daily recommendation cache", () => {
  it("filters invalid songs and deduplicates by source and id", () => {
    const result = normalizeDailySongs([
      song("1"),
      song("1", { name: "Duplicate" }),
      song("2"),
      { ...song("3"), name: "" },
      { ...song("4"), id: "" },
      null,
    ]);

    expect(result).toEqual([song("1"), song("2")]);
  });

  it("sorts snapshots newest first and retains only fifteen dates", () => {
    const snapshots = Array.from({ length: 18 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      songs: [song(String(index + 1))],
      cachedAt: index + 1,
    }));

    const result = normalizeDailyRecommendHistory(snapshots);

    expect(result).toHaveLength(15);
    expect(result[0]?.date).toBe("2026-08-18");
    expect(result[result.length - 1]?.date).toBe("2026-08-04");
  });

  it("drops malformed and empty snapshots and keeps the newest duplicate date", () => {
    const result = normalizeDailyRecommendHistory([
      { date: "2026-08-19", songs: [song("old")], cachedAt: 1 },
      { date: "2026-08-19", songs: [song("new")], cachedAt: 2 },
      { date: "invalid", songs: [song("x")], cachedAt: 3 },
      { date: "2026-08-18", songs: [], cachedAt: 4 },
    ]);

    expect(result).toEqual([
      { date: "2026-08-19", songs: [song("new")], cachedAt: 2 },
    ]);
  });
});
