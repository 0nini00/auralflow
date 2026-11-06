import { describe, expect, it } from "vitest";
import type { MusicInfo } from "../sources";
import {
  addHistoryEntry,
  historyEntryKey,
  historySongs,
  mergeHistoryEntries,
  normalizeHistoryEntries,
  pruneHistoryEntries,
  selectHistoryForSync,
  toHistoryPlayEntries,
  trimHistorySong,
  type HistoryEntry,
} from "./entries";

const song = (id: string, source: MusicInfo["source"] = "wy"): MusicInfo => ({
  id,
  source,
  name: `Song ${id}`,
  singer: "Artist",
  albumName: "",
});

const local = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).getTime();

const entry = (id: string, playedAt: number): HistoryEntry => ({
  key: `wy:${id}`,
  song: song(id),
  playedAt,
});

describe("historyEntryKey", () => {
  it("按 source:id 生成去重键", () => {
    expect(historyEntryKey(song("42"))).toBe("wy:42");
    expect(historyEntryKey(song("42", "tx"))).toBe("tx:42");
  });
});

describe("addHistoryEntry", () => {
  it("同一天同一首歌只留一条，时间刷新到最近一次", () => {
    const today = local(2026, 7, 15, 10);
    const later = local(2026, 7, 15, 18);
    const first = addHistoryEntry([], song("a"), today);
    const second = addHistoryEntry(first, song("a"), later);
    expect(second).toHaveLength(1);
    expect(second[0].playedAt).toBe(later);
  });

  it("跨天保留两条，并按时间倒序", () => {
    const yesterday = local(2026, 7, 14, 20);
    const today = local(2026, 7, 15, 9);
    const entries = addHistoryEntry(addHistoryEntry([], song("a"), yesterday), song("a"), today);
    expect(entries.map((item) => item.playedAt)).toEqual([today, yesterday]);
  });

  it("没有 id 的歌曲不写入", () => {
    expect(addHistoryEntry([], { ...song("a"), id: "" }, 1)).toEqual([]);
  });
});

describe("normalizeHistoryEntries", () => {
  it("丢掉坏条目，未知时间排最后，按上限截断", () => {
    const entries = [
      entry("a", local(2026, 7, 15, 9)),
      entry("b", 0),
      { key: "", song: song("c"), playedAt: 1 },
      { key: "wy:d", song: { ...song("d"), id: "" }, playedAt: 1 },
      entry("e", local(2026, 7, 14, 9)),
    ];
    const now = local(2026, 7, 15, 18);
    const normalized = normalizeHistoryEntries(entries, 2, now);
    // 真实条目按上限截断；时间未知的条目走单独预算，仍然保留。
    expect(normalized.map((item) => item.key)).toEqual(["wy:a", "wy:e", "wy:b"]);
    expect(normalizeHistoryEntries([entry("b", 0)], 2, now)[0].playedAt).toBe(0);
  });
});

describe("mergeHistoryEntries", () => {
  it("同 key 同本地日去重，真实时间胜过未知", () => {
    const day = local(2026, 7, 15, 10);
    const merged = mergeHistoryEntries(
      [{ ...entry("a", 0), song: { ...song("a"), name: "local" } }],
      [{ ...entry("a", day), song: { ...song("a"), name: "remote" } }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].playedAt).toBe(day);
    expect(merged[0].song.name).toBe("remote");
  });

  it("不同天各自保留", () => {
    const merged = mergeHistoryEntries(
      [entry("a", local(2026, 7, 14, 10))],
      [entry("a", local(2026, 7, 15, 10))],
    );
    expect(merged).toHaveLength(2);
  });
});

describe("派生", () => {
  it("historySongs 按最近顺序去重", () => {
    const entries = [entry("a", 3), entry("b", 2), entry("a", 1)];
    expect(historySongs(entries)).toEqual([song("a"), song("b")]);
  });

  it("toHistoryPlayEntries 只给真实时间填 playedAt", () => {
    expect(toHistoryPlayEntries([entry("a", 5), entry("b", 0)])).toEqual([
      { song: song("a"), playedAt: 5 },
      { song: song("b") },
    ]);
  });
});

describe("保留策略", () => {
  const now = local(2026, 7, 15, 18);

  it("只保留最近 365 天", () => {
    const kept = pruneHistoryEntries([
      entry("old", local(2025, 7, 1, 10)),
      entry("edge", local(2025, 7, 16, 10)),
      entry("new", local(2026, 7, 10, 10)),
    ], { now });
    expect(kept.map((item) => item.key)).toEqual(["wy:new", "wy:edge"]);
  });

  it("超上限时按整天裁剪，不把一个自然日切成半天", () => {
    const kept = pruneHistoryEntries([
      entry("today-a", local(2026, 7, 15, 9)),
      entry("today-b", local(2026, 7, 15, 10)),
      entry("yesterday-a", local(2026, 7, 14, 9)),
      entry("yesterday-b", local(2026, 7, 14, 10)),
    ], { now, maxEntries: 3 });
    expect(kept.map((item) => item.key)).toEqual(["wy:today-b", "wy:today-a"]);
  });

  it("时间未知单独限量，且不比同曲的真实记录优先", () => {
    const unknown = Array.from({ length: 5 }, (_, i) => entry(`unknown-${i}`, 0));
    expect(pruneHistoryEntries(unknown, { now, maxUnknownEntries: 2 })).toHaveLength(2);

    // 同一首歌既有未知哨兵又有真实时间：未知那条被真实记录吸收。
    const kept = pruneHistoryEntries([entry("real", 0), entry("real", now - 1000), ...unknown], {
      now,
      maxUnknownEntries: 5,
    });
    expect(kept.filter((item) => item.key === "wy:real").map((item) => item.playedAt)).toEqual([now - 1000]);
    expect(kept).toHaveLength(6);
  });

  it("统计/同步窗口只保留最近 180 天", () => {
    const day = 24 * 60 * 60 * 1000;
    const kept = selectHistoryForSync([
      entry("too-old", now - 181 * day),
      entry("edge", now - 179 * day),
    ], now);
    expect(kept.map((item) => item.key)).toEqual(["wy:edge"]);
  });
});

describe("快照裁剪", () => {
  it("img 与 picUrl 相同时只留 img，不影响封面读取", () => {
    const url = "https://p1.music.126.net/cover.jpg";
    const trimmed = trimHistorySong({ ...song("x"), img: url, picUrl: url });
    expect(trimmed.img).toBe(url);
    expect(trimmed.picUrl).toBeUndefined();

    const different = trimHistorySong({ ...song("y"), img: url, picUrl: "https://other/cover.jpg" });
    expect(different.picUrl).toBe("https://other/cover.jpg");
  });
});
