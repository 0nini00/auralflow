import { describe, expect, it } from "vitest";

import {
  formatPlayCount,
  groupLeaderboards,
  mapLeaderboardBoards,
  WY_BOARD_GROUPS,
  WY_PLAYLIST_CATEGORIES,
} from "./leaderboard";

/**
 * 这套用例锚定「排行榜 / 歌单广场」的共享口径。
 *
 * 之所以要测静态清单本身：它是两端共用的硬编码号令（榜单 id 与分类名），
 * 加一条、改一个 id，都必须被这里挡住或者被这里记录下来，不能靠人眼比对。
 */

describe("内置榜单清单", () => {
  it("榜单 id 全局唯一且非空", () => {
    const ids = WY_BOARD_GROUPS.flatMap((group) => group.boards.map((board) => board.id));
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true);
  });

  it("四个分组的顺序与规模固定", () => {
    expect(WY_BOARD_GROUPS.map((group) => group.key)).toEqual([
      "official",
      "language",
      "genre",
      "scene",
    ]);
    expect(WY_BOARD_GROUPS.map((group) => group.boards.length)).toEqual([4, 10, 8, 6]);
  });

  it("每个分组都有标题，每条榜单都有名字", () => {
    for (const group of WY_BOARD_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0);
      for (const board of group.boards) {
        expect(board.name.length).toBeGreaterThan(0);
      }
    }
  });

  it("分类清单以「全部」打头且不重复", () => {
    expect(WY_PLAYLIST_CATEGORIES[0]).toBe("全部");
    expect(new Set(WY_PLAYLIST_CATEGORIES).size).toBe(WY_PLAYLIST_CATEGORIES.length);
  });
});

describe("mapLeaderboardBoards", () => {
  it("接口元数据按 id 合并进内置清单", () => {
    const boards = mapLeaderboardBoards([
      {
        id: 19723756,
        coverImgUrl: "https://p1.music.126.net/a.jpg",
        updateFrequency: "每天更新",
        tracks: [
          { first: "第一首", second: "歌手甲" },
          { first: "第二首", second: "歌手乙" },
        ],
      },
    ]);

    const rising = boards.find((board) => board.id === "19723756");
    expect(rising).toMatchObject({
      name: "飙升榜",
      group: "official",
      coverUrl: "https://p1.music.126.net/a.jpg",
      updateFrequency: "每天更新",
      topSongs: [
        { title: "第一首", artist: "歌手甲" },
        { title: "第二首", artist: "歌手乙" },
      ],
    });
  });

  it("列表顺序始终来自内置清单，与接口返回顺序无关", () => {
    const boards = mapLeaderboardBoards([{ id: 7785066739 }, { id: 19723756 }]);
    const builtinOrder = WY_BOARD_GROUPS.flatMap((group) => group.boards.map((board) => board.id));
    expect(boards.map((board) => board.id)).toEqual(builtinOrder);
  });

  it("接口失败（非数组）时退化为只有 id + name 的内置清单", () => {
    for (const broken of [undefined, null, {}, "boom", 42]) {
      const boards = mapLeaderboardBoards(broken);
      expect(boards).toHaveLength(28);
      expect(boards.every((board) => board.coverUrl === undefined)).toBe(true);
      expect(boards.every((board) => board.topSongs === undefined)).toBe(true);
    }
  });

  it("接口里多出来的榜单不会凭空出现在页面上", () => {
    const boards = mapLeaderboardBoards([{ id: 999999999, coverImgUrl: "x" }]);
    expect(boards.some((board) => board.id === "999999999")).toBe(false);
  });

  it("缺曲名或字段类型不对的元数据被当作缺失处理", () => {
    const boards = mapLeaderboardBoards([
      {
        id: 19723756,
        coverImgUrl: 123,
        updateFrequency: null,
        tracks: [{ first: "", second: "无曲名" }, null, { second: "只有歌手" }],
      },
    ]);
    const rising = boards.find((board) => board.id === "19723756");
    expect(rising?.coverUrl).toBeUndefined();
    expect(rising?.updateFrequency).toBeUndefined();
    expect(rising?.topSongs).toBeUndefined();
  });
});

describe("groupLeaderboards", () => {
  it("按内置分组切开且丢掉空分组", () => {
    const boards = mapLeaderboardBoards(undefined);
    const sections = groupLeaderboards(boards);
    expect(sections.map((section) => section.key)).toEqual(["official", "language", "genre", "scene"]);
    expect(sections.map((section) => section.boards.length)).toEqual([4, 10, 8, 6]);

    expect(groupLeaderboards([])).toEqual([]);
    expect(groupLeaderboards(boards.filter((board) => board.group === "genre")).map((s) => s.key))
      .toEqual(["genre"]);
  });
});

describe("formatPlayCount", () => {
  it("按万/亿换算，缺失与非正数不产出角标", () => {
    expect(formatPlayCount(undefined)).toBeNull();
    expect(formatPlayCount(null)).toBeNull();
    expect(formatPlayCount(0)).toBeNull();
    expect(formatPlayCount(-5)).toBeNull();
    expect(formatPlayCount(Number.NaN)).toBeNull();
    expect(formatPlayCount(9999)).toBe("9999");
    expect(formatPlayCount(10000)).toBe("1万");
    expect(formatPlayCount(123456)).toBe("12万");
    expect(formatPlayCount(99_999_999)).toBe("10000万");
    expect(formatPlayCount(150_000_000)).toBe("1.5亿");
  });
});
