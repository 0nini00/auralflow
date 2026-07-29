import { describe, expect, it } from "vitest";

import { buildDailyRecommendMeta } from "@/services/dailyRecommendMetaModel";

describe("daily recommend meta model", () => {
  it("builds desktop-aligned update copy with the local date", () => {
    expect(buildDailyRecommendMeta(new Date(2026, 6, 7, 10, 20))).toEqual({
      title: "每日歌曲推荐",
      subtitle: "根据你的口味，每日 6:00 更新 · 2026-07-07",
    });
  });

  it("uses 今日 when the date is invalid", () => {
    expect(buildDailyRecommendMeta(new Date(Number.NaN)).subtitle).toBe(
      "根据你的口味，每日 6:00 更新 · 今日",
    );
  });
});
