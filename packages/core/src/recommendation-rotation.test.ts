import { describe, expect, it } from "vitest";
import {
  buildRecommendationDateKey,
  buildRecommendationSeed,
  pickRecentRecommendationIds,
  recordRecommendationHistory,
  rotateRecommendations,
  shuffleWithRecommendationSeed,
  type RecommendationHistoryEntry,
} from "./recommendation-rotation";

const pool = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `歌单 ${index + 1}` }));

describe("种子化洗牌", () => {
  it("同一种子产出同一顺序（双端必须一致）", () => {
    const first = shuffleWithRecommendationSeed(pool(20), "2026-11-01#0");
    const second = shuffleWithRecommendationSeed(pool(20), "2026-11-01#0");
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
  });

  it("不同种子产出不同顺序", () => {
    const a = shuffleWithRecommendationSeed(pool(20), "2026-11-01#0").map((item) => item.id);
    const b = shuffleWithRecommendationSeed(pool(20), "2026-11-01#1").map((item) => item.id);
    expect(a).not.toEqual(b);
  });

  it("不改动入参且不丢项", () => {
    const source = pool(10);
    const before = source.map((item) => item.id);
    const shuffled = shuffleWithRecommendationSeed(source, "seed");
    expect(source.map((item) => item.id)).toEqual(before);
    expect([...shuffled.map((item) => item.id)].sort()).toEqual([...before].sort());
  });
});

describe("每日一版 + 换一批", () => {
  it("同一天同一批稳定，换一批给出另一份", () => {
    const today = "2026-11-01";
    const candidates = pool(60);
    const first = rotateRecommendations(candidates, buildRecommendationSeed(today, 0), { limit: 12 });
    const repeat = rotateRecommendations(candidates, buildRecommendationSeed(today, 0), { limit: 12 });
    const nextBatch = rotateRecommendations(candidates, buildRecommendationSeed(today, 1), { limit: 12 });

    expect(first.map((item) => item.id)).toEqual(repeat.map((item) => item.id));
    expect(first.map((item) => item.id)).not.toEqual(nextBatch.map((item) => item.id));
    expect(first).toHaveLength(12);
  });

  it("跨天换一版", () => {
    const candidates = pool(60);
    const day1 = rotateRecommendations(candidates, buildRecommendationSeed("2026-11-01", 0), { limit: 12 });
    const day2 = rotateRecommendations(candidates, buildRecommendationSeed("2026-11-02", 0), { limit: 12 });
    expect(day1.map((item) => item.id)).not.toEqual(day2.map((item) => item.id));
  });

  it("近期展示过的排在后面：候选足够时不重复", () => {
    const candidates = pool(60);
    const seed = buildRecommendationSeed("2026-11-01", 1);
    const already = rotateRecommendations(candidates, buildRecommendationSeed("2026-11-01", 0), { limit: 12 });
    const next = rotateRecommendations(candidates, seed, {
      limit: 12,
      recentIds: already.map((item) => item.id),
    });

    const shownBefore = new Set(already.map((item) => item.id));
    expect(next.every((item) => !shownBefore.has(item.id))).toBe(true);
  });

  it("新鲜候选不足一屏时用已见补齐，不给半屏", () => {
    const candidates = pool(5);
    const recentIds = candidates.slice(0, 4).map((item) => item.id);
    const result = rotateRecommendations(candidates, "seed", { limit: 4, recentIds });

    expect(result).toHaveLength(4);
    // 新鲜的那 1 条排第一位，其余由「刚见过」的补齐
    expect(recentIds.includes(result[0].id)).toBe(false);
  });

  it("按 id 去重，空池返回空", () => {
    const duplicated = [...pool(3), { id: "p1", name: "重复" }, { id: "", name: "无 id" }];
    expect(rotateRecommendations(duplicated, "seed", { limit: 10 }).map((item) => item.id)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    expect(rotateRecommendations([], "seed", { limit: 10 })).toEqual([]);
  });
});

describe("展示历史", () => {
  const today = "2026-11-10";

  it("同一歌单只保留最近一次并把旧记录留在窗口内", () => {
    const history: RecommendationHistoryEntry[] = [
      { id: "old", dateKey: "2026-10-20" }, // 窗口外（21 天前）
      { id: "a", dateKey: "2026-11-08" },
      { id: "b", dateKey: "2026-11-09" },
    ];
    const next = recordRecommendationHistory(history, ["a", "c"], today);

    expect(next.map((entry) => entry.id)).toEqual(["b", "a", "c"]);
    expect(next.every((entry) => entry.dateKey === today || entry.dateKey >= "2026-10-28")).toBe(true);
  });

  it("超出上限时丢最旧的", () => {
    const history: RecommendationHistoryEntry[] = [
      { id: "x", dateKey: "2026-11-02" },
      { id: "y", dateKey: "2026-11-03" },
    ];
    const next = recordRecommendationHistory(history, ["z"], today, { cap: 2 });
    expect(next.map((entry) => entry.id)).toEqual(["y", "z"]);
  });

  it("窗口内的 id 按新→旧返回，窗口外的丢掉", () => {
    const history: RecommendationHistoryEntry[] = [
      { id: "very-old", dateKey: "2026-10-01" },
      { id: "a", dateKey: "2026-11-09" },
      { id: "b", dateKey: "2026-11-10" },
    ];
    expect(pickRecentRecommendationIds(history, today)).toEqual(["b", "a"]);
  });

  it("日期无法解析时不崩溃", () => {
    expect(pickRecentRecommendationIds([{ id: "a", dateKey: "not-a-date" }], today)).toEqual([]);
    expect(recordRecommendationHistory([], ["a"], "2026-99-99")).toEqual([]);
  });
});

describe("日期与种子", () => {
  it("日期键用本地日历日，跨月补零", () => {
    expect(buildRecommendationDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(buildRecommendationDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("批次号归一化：负数与小数不产生非法种子", () => {
    expect(buildRecommendationSeed("2026-11-01", -3)).toBe("2026-11-01#0");
    expect(buildRecommendationSeed("2026-11-01", 2.9)).toBe("2026-11-01#2");
  });
});
