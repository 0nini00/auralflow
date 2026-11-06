import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dayStartOf,
  filterEntriesByDay,
  formatHistoryDayTitle,
  getMonthCalendarDays,
  groupEntriesByDay,
  isSameDay,
} from "./day-groups";

const local = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).getTime();

const now = local(2026, 7, 15, 18);

describe("dayStartOf / addDays / isSameDay", () => {
  it("按本地日历日归零，跨日差一天", () => {
    expect(dayStartOf(now)).toBe(local(2026, 7, 15, 0));
    expect(addDays(dayStartOf(now), -1)).toBe(local(2026, 7, 14, 0));
    expect(addDays(dayStartOf(now), 1)).toBe(local(2026, 7, 16, 0));
    expect(isSameDay(local(2026, 7, 15, 0), local(2026, 7, 15, 23))).toBe(true);
    expect(isSameDay(local(2026, 7, 15, 23), local(2026, 7, 16, 0))).toBe(false);
  });

  it("跨月用日历运算，不按 24 小时硬算", () => {
    expect(addDays(local(2026, 3, 1, 0), -1)).toBe(local(2026, 2, 28, 0));
    expect(addMonths(local(2026, 1, 31, 0), 1)).toBe(local(2026, 2, 1, 0));
  });
});

describe("formatHistoryDayTitle", () => {
  it("今天 / 昨天 / 今年日期 / 跨年日期", () => {
    expect(formatHistoryDayTitle(local(2026, 7, 15, 0), now)).toBe("今天");
    expect(formatHistoryDayTitle(local(2026, 7, 14, 0), now)).toBe("昨天");
    expect(formatHistoryDayTitle(local(2026, 6, 30, 0), now)).toBe("6月30日");
    expect(formatHistoryDayTitle(local(2025, 12, 31, 0), now)).toBe("2025年12月31日");
  });
});

describe("groupEntriesByDay", () => {
  const entries = [
    { id: "a", playedAt: local(2026, 7, 15, 9) },
    { id: "b", playedAt: local(2026, 7, 15, 20) },
    { id: "c", playedAt: local(2026, 7, 14, 8) },
    { id: "unknown", playedAt: 0 },
  ];

  it("按本地日分组，组与组内都倒序，时间未知被忽略", () => {
    const groups = groupEntriesByDay(entries, now);
    expect(groups.map((group) => group.title)).toEqual(["今天", "昨天"]);
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(groups[1].entries.map((entry) => entry.id)).toEqual(["c"]);
  });

  it("只含时间未知条目时返回空分组", () => {
    expect(groupEntriesByDay([{ id: "x", playedAt: 0 }], now)).toEqual([]);
  });
});

describe("filterEntriesByDay", () => {
  const entries = [
    { id: "midnight", playedAt: local(2026, 7, 15, 0) },
    { id: "noon", playedAt: local(2026, 7, 15, 12) },
    { id: "next", playedAt: local(2026, 7, 16, 0) },
  ];

  it("左闭右开，并保持时间倒序", () => {
    expect(filterEntriesByDay(entries, local(2026, 7, 15, 0)).map((entry) => entry.id)).toEqual([
      "noon",
      "midnight",
    ]);
  });
});

describe("getMonthCalendarDays", () => {
  it("按周补齐，未来与无记录日期禁用", () => {
    const days = getMonthCalendarDays([local(2026, 7, 3, 0), local(2026, 7, 10, 0)], local(2026, 7, 1, 0), local(2026, 7, 3, 0), now);
    // 2026-07-01 是周三：前面补 3 格，31 天 → 34 格补到 35
    expect(days).toHaveLength(35);
    expect(days.slice(0, 3)).toEqual([null, null, null]);
    const first = days[3];
    expect(first).toMatchObject({ dayStart: local(2026, 7, 1, 0), disabled: true, selected: false });
    expect(days[5]).toMatchObject({ dayStart: local(2026, 7, 3, 0), disabled: false, selected: true });
    const future = days.find((cell) => cell?.dayStart === local(2026, 7, 20, 0));
    expect(future).toMatchObject({ disabled: true, selected: false });
  });
});
