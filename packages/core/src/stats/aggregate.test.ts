import { describe, expect, it } from "vitest";
import type { MusicInfo } from "../sources";
import {
  aggregateListeningStats,
  type HistoryPlayEntry,
  type ListeningStats,
  type ListeningStatsInput,
} from "./aggregate";

/** 造一条 MusicInfo：`interval` 是**秒**（与两端实现一致），默认 200 秒。 */
const makeSong = (id: string, overrides: Partial<MusicInfo> = {}): MusicInfo => ({
  id,
  name: `歌曲 ${id}`,
  singer: "歌手 A",
  albumName: "专辑",
  source: "wy",
  interval: 200,
  ...overrides,
});

/** 造一条移动端形态的条目（`HistoryEntry` 的字段子集：`song` + `playedAt`）。 */
const entry = (song: MusicInfo, playedAt?: number): HistoryPlayEntry => ({ song, playedAt });

/**
 * 用**本地时间**构造时间戳：断言与实现共用同一套本地口径，因此在任意宿主时区下都成立。
 * 日期取 2024-05-15 前后：避开各时区的 DST 切换日（南半球 4/10 月、北美 3/11 月），
 * 保证「本地 00:00 一定存在」「一天恰好 24 小时」这些前提在测试里成立。
 */
const localTime = (month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number =>
  new Date(2024, month - 1, day, hour, minute, second, ms).getTime();

const dayKeys = (stats: ListeningStats): string[] => stats.byDay.map((d) => d.day);
const trackKeys = (stats: ListeningStats): string[] => stats.topTracks.map((t) => t.key);
const artistNames = (stats: ListeningStats): string[] => stats.topArtists.map((a) => a.name);

/** 输出里所有数值字段都必须是有限数：NaN / Infinity 泄漏会直接画坏 UI 的条形长度。 */
const expectFiniteNumbers = (stats: ListeningStats): void => {
  expect(Number.isFinite(stats.totalMs)).toBe(true);
  expect(Number.isFinite(stats.totalPlays)).toBe(true);
  expect(Number.isFinite(stats.playsWithoutDuration)).toBe(true);
  for (const track of stats.topTracks) {
    expect(Number.isFinite(track.plays)).toBe(true);
    expect(Number.isFinite(track.totalMs)).toBe(true);
  }
  for (const artist of stats.topArtists) {
    expect(Number.isFinite(artist.plays)).toBe(true);
    expect(Number.isFinite(artist.totalMs)).toBe(true);
  }
  for (const day of stats.byDay) {
    expect(Number.isFinite(day.dayStart)).toBe(true);
    expect(Number.isFinite(day.plays)).toBe(true);
    expect(Number.isFinite(day.totalMs)).toBe(true);
  }
};

describe("aggregateListeningStats：空与单条", () => {
  it("空数组 → 全零，三个榜单为空数组", () => {
    expect(aggregateListeningStats([])).toEqual({
      totalMs: 0,
      totalPlays: 0,
      playsWithoutDuration: 0,
      topTracks: [],
      topArtists: [],
      byDay: [],
    });
  });

  it("null / undefined 输入（历史未落盘 / 读盘失败）→ 全零，不抛", () => {
    for (const value of [null, undefined]) {
      const stats = aggregateListeningStats(value);
      expect(stats.totalMs).toBe(0);
      expect(stats.totalPlays).toBe(0);
      expect(stats.topTracks).toEqual([]);
      expect(stats.byDay).toEqual([]);
    }
  });

  it("接受移动端 HistoryEntry 形状（多一个 key 字段，结构仍然兼容）", () => {
    // 与 apps/mobile/src/services/historyGroupModel.ts:9-15 同形：{ key: "source:id"; song: MusicInfo; playedAt: number }
    const mobileEntries: Array<{ key: string; song: MusicInfo; playedAt: number }> = [
      { key: "wy:1", song: makeSong("1", { interval: 100 }), playedAt: localTime(5, 15, 9) },
    ];
    const stats = aggregateListeningStats(mobileEntries);

    expect(stats.totalPlays).toBe(1);
    expect(stats.totalMs).toBe(100_000);
    expect(trackKeys(stats)).toEqual(["wy:1"]);
    expect(dayKeys(stats)).toEqual(["2024-05-15"]);
  });

  it("单条记录 → 次数 1、时长 = interval 秒 × 1000，歌曲/歌手/天各一条", () => {
    const song = makeSong("1", { interval: 253, singer: "歌手 B" });
    const stats = aggregateListeningStats([entry(song, localTime(5, 15, 10, 30))]);

    expect(stats.totalPlays).toBe(1);
    expect(stats.totalMs).toBe(253_000);
    expect(stats.playsWithoutDuration).toBe(0);

    // 去重键与两端 historyStore 的 `${source}:${id}` 一致
    expect(stats.topTracks).toEqual([
      { key: "wy:1", song, plays: 1, totalMs: 253_000 },
    ]);
    expect(stats.topArtists).toEqual([{ name: "歌手 B", plays: 1, totalMs: 253_000 }]);
    expect(stats.byDay).toEqual([
      {
        day: "2024-05-15",
        dayStart: localTime(5, 15),
        plays: 1,
        totalMs: 253_000,
      },
    ]);
  });

  it("桌面方言（裸 MusicInfo[]，没有时间戳）→ 总数照算，byDay 为空", () => {
    const stats = aggregateListeningStats([makeSong("1"), makeSong("2", { interval: 100 })]);

    expect(stats.totalPlays).toBe(2);
    expect(stats.totalMs).toBe(300_000);
    expect(trackKeys(stats)).toEqual(["wy:1", "wy:2"]);
    // 桌面 history 不存 playedAt，不按数组下标编造播放时间
    expect(stats.byDay).toEqual([]);
  });
});

describe("aggregateListeningStats：同曲累加", () => {
  it("同一首歌多次播放 → 次数与时长按条目数累加", () => {
    const song = makeSong("9", { interval: 120 });
    const stats = aggregateListeningStats([
      entry(song, localTime(5, 15, 9)),
      entry(song, localTime(5, 15, 12)),
      entry(song, localTime(5, 15, 18)),
    ]);

    expect(stats.totalPlays).toBe(3);
    expect(stats.totalMs).toBe(360_000);
    expect(stats.topTracks).toHaveLength(1);
    expect(stats.topTracks[0].plays).toBe(3);
    expect(stats.topTracks[0].totalMs).toBe(360_000);
    expect(stats.topArtists[0].plays).toBe(3);
    // 同一天的 3 次合并成一天
    expect(stats.byDay).toHaveLength(1);
    expect(stats.byDay[0].plays).toBe(3);
    expect(stats.byDay[0].totalMs).toBe(360_000);
  });

  it("同曲跨天的多条条目分别累加（移动端「跨天保留多次播放」的真实形态）", () => {
    const song = makeSong("9", { interval: 60 });
    const stats = aggregateListeningStats([
      entry(song, localTime(5, 15, 23, 50)),
      entry(song, localTime(5, 16, 0, 10)),
    ]);

    expect(stats.totalPlays).toBe(2);
    expect(stats.totalMs).toBe(120_000);
    expect(dayKeys(stats)).toEqual(["2024-05-15", "2024-05-16"]);
    expect(stats.byDay.map((d) => d.plays)).toEqual([1, 1]);
  });

  it("同曲元数据不一致时，各条按自身 interval 记时长；榜单代表快照取首次出现那条", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("7", { name: "旧名", interval: 100 }), localTime(5, 15, 8)),
      entry(makeSong("7", { name: "新名", interval: 200 }), localTime(5, 15, 9)),
    ]);

    expect(stats.topTracks).toHaveLength(1);
    // 移动端按播放时间倒序传入 → 首条即最近一次的元数据快照
    expect(stats.topTracks[0].song.name).toBe("旧名");
    expect(stats.topTracks[0].plays).toBe(2);
    expect(stats.topTracks[0].totalMs).toBe(300_000);
  });
});

describe("aggregateListeningStats：按天趋势（宿主本地日口径）", () => {
  /*
   * 口径确认（本文件把约定写死在这里）：**按宿主本地时区的日历日**切分，边界是本地 00:00，
   * 不是 UTC 日、也不是「滚动 24 小时窗」。时间戳一律用 `new Date(本地年月日…)` 构造，
   * 所以断言与宿主时区无关：
   * - 宿主 UTC+8：`localTime(5, 15, 23, 59, 59, 999)` 的 UTC 时刻是 2024-05-15T15:59:59.999Z，
   *   相隔 1ms 的次日 00:00 是 2024-05-15T16:00:00Z（UTC 同一天），但本地已跨天；
   * - 宿主 UTC-8：同一个时间戳的 UTC 时刻是 2024-05-16T07:59:59.999Z（UTC 已是次日），
   *   本地仍是 15 日。
   * 即同一批数据在不同时区可能得到不同的 day 字符串——这是刻意的：口径与移动端
   * `historyGroupModel.dayStartOf` / `isSameDay`（apps/mobile/src/services/historyGroupModel.ts:33-36、71-73）
   * 以及「今天 / 昨天」展示一致，用户看到的是自己所在时区的「今天」。
   */
  it("同一天多条合并为一天，跨天分成两天", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("1"), localTime(5, 15, 9)),
      entry(makeSong("2"), localTime(5, 15, 23, 59)),
      entry(makeSong("3"), localTime(5, 16, 0, 0, 0, 1)),
    ]);

    expect(dayKeys(stats)).toEqual(["2024-05-15", "2024-05-16"]);
    expect(stats.byDay.map((d) => d.plays)).toEqual([2, 1]);
    expect(stats.byDay[0].dayStart).toBe(localTime(5, 15));
    expect(stats.byDay[1].dayStart).toBe(localTime(5, 16));
  });

  it("相隔 1ms 跨本地午夜算两天；同一天内跨近 24h 仍算一天（按日历日而非滚动窗口）", () => {
    const acrossMidnight = aggregateListeningStats([
      entry(makeSong("1"), localTime(5, 15, 23, 59, 59, 999)),
      entry(makeSong("2"), localTime(5, 16, 0, 0)),
    ]);
    expect(dayKeys(acrossMidnight)).toEqual(["2024-05-15", "2024-05-16"]);

    const sameDay = aggregateListeningStats([
      entry(makeSong("1"), localTime(5, 15, 0, 0, 0, 0)),
      entry(makeSong("2"), localTime(5, 15, 23, 59, 0, 0)),
    ]);
    expect(dayKeys(sameDay)).toEqual(["2024-05-15"]);
    expect(sameDay.byDay[0].plays).toBe(2);
  });

  it("byDay 按时间升序（趋势从左到右），与传入顺序无关", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("1"), localTime(5, 17, 8)),
      entry(makeSong("2"), localTime(5, 15, 8)),
      entry(makeSong("3"), localTime(5, 16, 8)),
    ]);

    expect(dayKeys(stats)).toEqual(["2024-05-15", "2024-05-16", "2024-05-17"]);
  });

  it("playedAt 缺失/非法（undefined / NaN / 0 / 负数 / 字符串）→ 不进 byDay，但计入总数与榜单", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("1"), localTime(5, 15, 8)),
      entry(makeSong("2")),
      entry(makeSong("3"), Number.NaN),
      entry(makeSong("4"), 0),
      entry(makeSong("5"), -1),
      entry(makeSong("6"), "1715000000000" as unknown as number),
    ]);

    expect(stats.totalPlays).toBe(6);
    expect(stats.totalMs).toBe(6 * 200_000);
    expect(trackKeys(stats)).toHaveLength(6);
    expect(dayKeys(stats)).toEqual(["2024-05-15"]);
    expect(stats.byDay[0].plays).toBe(1);
    expectFiniteNumbers(stats);
  });
});

describe("aggregateListeningStats：时长字段缺失/非法时降级", () => {
  it("interval 缺失 → 该条 0 ms，计入 playsWithoutDuration，且不泄漏 NaN", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("1", { interval: undefined }), localTime(5, 15, 9)),
    ]);

    expect(stats.totalPlays).toBe(1);
    expect(stats.totalMs).toBe(0);
    expect(stats.playsWithoutDuration).toBe(1);
    expect(stats.topTracks[0].totalMs).toBe(0);
    expect(stats.byDay[0].totalMs).toBe(0);
    expectFiniteNumbers(stats);
  });

  it("interval 为 NaN / 负数 / 0 / Infinity / 字符串 → 一律按 0 ms 计，输出无 NaN", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("1", { interval: Number.NaN }), localTime(5, 15, 9)),
      entry(makeSong("2", { interval: -1 }), localTime(5, 15, 10)),
      entry(makeSong("3", { interval: 0 }), localTime(5, 15, 11)),
      entry(makeSong("4", { interval: Number.POSITIVE_INFINITY }), localTime(5, 15, 12)),
      entry(makeSong("5", { interval: "300" as unknown as number }), localTime(5, 15, 13)),
    ]);

    expect(stats.totalPlays).toBe(5);
    expect(stats.totalMs).toBe(0);
    expect(stats.playsWithoutDuration).toBe(5);
    expect(stats.topTracks.map((t) => t.totalMs)).toEqual([0, 0, 0, 0, 0]);
    expect(stats.byDay[0].totalMs).toBe(0);
    expectFiniteNumbers(stats);
  });

  it("部分条目缺时长 → 只有带合法 interval 的算进总时长，缺的单独计数", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("1", { interval: 200 }), localTime(5, 15, 9)),
      entry(makeSong("2", { interval: 100 }), localTime(5, 15, 10)),
      entry(makeSong("3", { interval: undefined }), localTime(5, 15, 11)),
    ]);

    expect(stats.totalPlays).toBe(3);
    expect(stats.totalMs).toBe(300_000);
    expect(stats.playsWithoutDuration).toBe(1);
    // 不变式：条目都有 id 时，各榜单时长之和 = totalMs
    expect(stats.topTracks.reduce((sum, track) => sum + track.totalMs, 0)).toBe(stats.totalMs);
    expect(stats.topArtists[0].totalMs).toBe(300_000);
    expect(stats.byDay[0].totalMs).toBe(300_000);
    expectFiniteNumbers(stats);
  });
});

describe("aggregateListeningStats：榜单顺序确定性", () => {
  it("排序：次数降序 → 时长降序", () => {
    const stats = aggregateListeningStats([
      // 3 次 × 60s
      entry(makeSong("a", { interval: 60 }), localTime(5, 15, 1)),
      entry(makeSong("a", { interval: 60 }), localTime(5, 15, 2)),
      entry(makeSong("a", { interval: 60 }), localTime(5, 15, 3)),
      // 2 次 × 200s
      entry(makeSong("b", { interval: 200 }), localTime(5, 15, 4)),
      entry(makeSong("b", { interval: 200 }), localTime(5, 15, 5)),
      // 1 次 × 900s
      entry(makeSong("c", { interval: 900 }), localTime(5, 15, 6)),
      // 2 次 × 10s（次数与 b 并列，但时长更少）
      entry(makeSong("d", { interval: 10 }), localTime(5, 15, 7)),
      entry(makeSong("d", { interval: 10 }), localTime(5, 15, 8)),
    ]);

    expect(trackKeys(stats)).toEqual(["wy:a", "wy:b", "wy:d", "wy:c"]);
    expect(stats.topTracks.map((t) => t.plays)).toEqual([3, 2, 2, 1]);
  });

  it("次数与时长完全并列时按 key 升序（码位序），与传入顺序无关", () => {
    const items = [
      entry(makeSong("3"), localTime(5, 15, 1)),
      entry(makeSong("1"), localTime(5, 15, 2)),
      entry(makeSong("2"), localTime(5, 15, 3)),
    ];

    expect(trackKeys(aggregateListeningStats(items))).toEqual(["wy:1", "wy:2", "wy:3"]);
    expect(trackKeys(aggregateListeningStats([...items].reverse()))).toEqual(["wy:1", "wy:2", "wy:3"]);
  });

  it("歌手榜并列时按名称码位升序", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("1", { singer: "C" }), localTime(5, 15, 1)),
      entry(makeSong("2", { singer: "A" }), localTime(5, 15, 2)),
      entry(makeSong("3", { singer: "B" }), localTime(5, 15, 3)),
    ]);

    expect(artistNames(stats)).toEqual(["A", "B", "C"]);
  });

  it("歌手名首尾空白被归一（「 A 」与「A」合并为一个歌手）", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("1", { singer: " A " }), localTime(5, 15, 1)),
      entry(makeSong("2", { singer: "A" }), localTime(5, 15, 2)),
    ]);

    expect(stats.topArtists).toEqual([{ name: "A", plays: 2, totalMs: 400_000 }]);
  });

  it("不做 MAX_HISTORY 截断假设：传入 2001 条全部计入", () => {
    const items: ListeningStatsInput[] = Array.from({ length: 2001 }, (_unused, index) =>
      makeSong(String(index)),
    );
    const stats = aggregateListeningStats(items);

    expect(stats.totalPlays).toBe(2001);
    expect(stats.topTracks).toHaveLength(2001);
    expect(stats.totalMs).toBe(2001 * 200_000);
  });
});

describe("aggregateListeningStats：损坏数据容错", () => {
  it("null / undefined / 非对象条目被跳过，不抛异常", () => {
    const stats = aggregateListeningStats([
      null,
      undefined,
      42 as unknown as ListeningStatsInput,
      "x" as unknown as ListeningStatsInput,
      entry(makeSong("1"), localTime(5, 15, 9)),
    ]);

    expect(stats.totalPlays).toBe(1);
    expect(trackKeys(stats)).toEqual(["wy:1"]);
  });

  it("song 不是对象（如 { song: 42 }）的条目被跳过", () => {
    const stats = aggregateListeningStats([
      { song: 42, playedAt: localTime(5, 15, 9) } as unknown as ListeningStatsInput,
      entry(makeSong("1"), localTime(5, 15, 10)),
    ]);

    expect(stats.totalPlays).toBe(1);
    expect(trackKeys(stats)).toEqual(["wy:1"]);
  });

  it("缺 id 的条目仍计入总数/时长/按天，但不进歌曲榜", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("", { interval: 60 }), localTime(5, 15, 9)),
      entry(makeSong("1", { interval: 60 }), localTime(5, 15, 10)),
    ]);

    expect(stats.totalPlays).toBe(2);
    expect(stats.totalMs).toBe(120_000);
    expect(trackKeys(stats)).toEqual(["wy:1"]);
    expect(dayKeys(stats)).toEqual(["2024-05-15"]);
    expect(stats.byDay[0].plays).toBe(2);
  });

  it("singer 缺失或全空白的条目不进歌手榜，但计入总数与歌曲榜", () => {
    const stats = aggregateListeningStats([
      entry(makeSong("1", { singer: "   " }), localTime(5, 15, 9)),
      entry(makeSong("2", { singer: undefined }), localTime(5, 15, 10)),
      entry(makeSong("3", { singer: "歌手 C" }), localTime(5, 15, 11)),
    ]);

    expect(stats.totalPlays).toBe(3);
    expect(trackKeys(stats)).toEqual(["wy:1", "wy:2", "wy:3"]);
    expect(artistNames(stats)).toEqual(["歌手 C"]);
  });
});
