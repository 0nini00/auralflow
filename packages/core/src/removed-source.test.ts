import { describe, expect, it } from "vitest";

import { dropRemovedSourceEntries, isRemovedSource } from "./removed-source";

/**
 * 这套用例锚定一次**一次性数据迁移**：B 站（bili）来源被整体移除后，
 * 已落盘的收藏 / 历史 / 歌单歌曲里的那些条目既没有 provider 也点不动，
 * 必须在本端丢掉，否则会随 WebDAV 同步在两端来回传。
 *
 * 刻意用字面量对象而不是 `MusicInfo`：要构造的正是「类型上已不存在的旧数据」，
 * 用类型去描述它反而需要强转，那就掩盖了要测的东西。
 */
describe("isRemovedSource", () => {
  it("识别已移除来源（含大小写与空白差异）", () => {
    expect(isRemovedSource("bili")).toBe(true);
    expect(isRemovedSource("BILI")).toBe(true);
    expect(isRemovedSource("  bili  ")).toBe(true);
  });

  it("现有来源与非字符串都不算已移除", () => {
    for (const source of ["wy", "tx", "local", "netease", "qq", "", undefined, null, 42, {}]) {
      expect(isRemovedSource(source), String(source)).toBe(false);
    }
  });
});

describe("dropRemovedSourceEntries", () => {
  const removedSong = { id: "BV1xx411c7mD", name: "旧 B 站条目", source: "bili" };
  const wySong = { id: "123", name: "网易云条目", source: "wy" };
  const txSong = { id: "abc", name: "QQ 条目", source: "tx" };
  // 显式写成 source: undefined：TS 的弱类型检查不允许「完全没有 source 属性」的对象字面量，
  // 而运行时它与「JSON 里没有这个键」等价 —— 正是历史数据的样子。
  const noSourceSong = { id: "broken", name: "来源缺失的旧数据", source: undefined };

  it("丢掉已移除来源的条目并给出计数", () => {
    const { kept, dropped } = dropRemovedSourceEntries([removedSong, wySong, txSong]);

    expect(dropped).toEqual([removedSong]);
    expect(kept).toEqual([wySong, txSong]);
  });

  it("source 未定义 / 缺失的条目不误伤（未知数据不等于已知的已移除来源）", () => {
    const { kept, dropped } = dropRemovedSourceEntries([noSourceSong]);

    expect(dropped).toHaveLength(0);
    expect(kept).toEqual([noSourceSong]);
  });

  it("保持原顺序，且返回的是原对象引用", () => {
    const { kept } = dropRemovedSourceEntries([wySong, removedSong, txSong, noSourceSong]);

    expect(kept).toEqual([wySong, txSong, noSourceSong]);
    expect(kept[0]).toBe(wySong);
  });

  it("空 / null / undefined 输入不崩", () => {
    expect(dropRemovedSourceEntries([])).toEqual({ kept: [], dropped: [] });
    expect(dropRemovedSourceEntries(null)).toEqual({ kept: [], dropped: [] });
    expect(dropRemovedSourceEntries(undefined).kept).toHaveLength(0);
  });

  it("数组里的 null 条目不会被当成歌保留", () => {
    const { kept } = dropRemovedSourceEntries([null, wySong]);

    expect(kept).toEqual([wySong]);
  });

  it("能直接用于清理歌单里的歌曲列表", () => {
    const playlist = { id: "playlist_1", name: "我的歌单", songs: [removedSong, wySong] };

    const { kept } = dropRemovedSourceEntries(playlist.songs);

    expect(kept).toEqual([wySong]);
  });
});
