import { describe, expect, it } from "vitest";
import { filterEntriesByDay, addDays, formatHistoryDayTitle, dayStartOf } from "./historyGroupModel";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("filterEntriesByDay", () => {
  it("仅过滤当天条目且按 playedAt 倒序", () => {
    const now = Date.now();
    const todayStart = dayStartOf(now);

    const entries = [
      { key: "1", song: { source: "test", id: "1" }, playedAt: todayStart + 1000 }, // 今天最早
      { key: "2", song: { source: "test", id: "2" }, playedAt: todayStart + 5000 }, // 今天稍晚
      { key: "3", song: { source: "test", id: "3" }, playedAt: todayStart - 1000 }, // 昨天
      { key: "4", song: { source: "test", id: "4" }, playedAt: todayStart + 3000 }, // 今天中间
    ];

    const filtered = filterEntriesByDay(entries, todayStart);

    expect(filtered.length).toBe(3);
    expect(filtered[0].playedAt).toBe(todayStart + 5000); // 倒序第一个
    expect(filtered[2].playedAt).toBe(todayStart + 1000); // 倒序最后一个
    expect(filtered.every(e => e.playedAt >= todayStart && e.playedAt < todayStart + DAY_MS)).toBe(true);
  });
});

describe("addDays", () => {
  it("addDays(t, 1) === t + DAY_MS", () => {
    const t = 1000;
    expect(addDays(t, 1)).toBe(t + DAY_MS);
  });
});

describe("formatHistoryDayTitle", () => {
  it("今天/昨天文案", () => {
    const now = Date.now();
    const todayStart = dayStartOf(now);

    expect(formatHistoryDayTitle(todayStart, now)).toBe("今天");
    expect(formatHistoryDayTitle(todayStart - DAY_MS, now)).toBe("昨天");
  });
});
