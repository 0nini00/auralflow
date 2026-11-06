import { describe, expect, it } from "vitest";
import type { MusicInfo } from "../sources";
import {
  addHistoryEntry,
  historyEntryKey,
  historySongs,
  mergeHistoryEntries,
  normalizeHistoryEntries,
  toHistoryPlayEntries,
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
    const normalized = normalizeHistoryEntries(entries, 2);
    expect(normalized).toHaveLength(2);
    expect(normalized.map((item) => item.key)).toEqual(["wy:a", "wy:e"]);
    expect(normalizeHistoryEntries([entry("b", 0)])[0].playedAt).toBe(0);
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
