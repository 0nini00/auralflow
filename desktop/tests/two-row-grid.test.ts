import { describe, expect, it } from "vitest";
import { layoutTwoRows } from "../src/utils/twoRowGrid";

describe("layoutTwoRows", () => {
  it("偶数条目：列数 = n / 2，正好两行等长", () => {
    const { items, columns } = layoutTwoRows(["a", "b", "c", "d", "e", "f"]);
    expect(items).toHaveLength(6);
    expect(columns).toBe(3);
  });

  it("奇数条目（≥ 6）：丢掉最后一条，两行仍然等长", () => {
    // 首页推荐歌单：接口给 12 条，第一张进主推卡，剩 11 条 → 取 10 条排 5 列。
    const input = Array.from({ length: 11 }, (_, index) => index);
    const { items, columns } = layoutTwoRows(input);
    expect(items).toHaveLength(10);
    expect(columns).toBe(5);
    expect(items).not.toContain(10);
  });

  it("短列表一条都不丢（内容是有限的，删数据只会让人少看到东西）", () => {
    expect(layoutTwoRows(["only"])).toEqual({ items: ["only"], columns: 1 });
    expect(layoutTwoRows(["a", "b", "c"])).toEqual({ items: ["a", "b", "c"], columns: 2 });
  });

  it("空列表：列数兜底为 1，不抛错", () => {
    expect(layoutTwoRows([])).toEqual({ items: [], columns: 1 });
  });

  it("不修改传入的数组", () => {
    const input = ["a", "b", "c", "d", "e", "f", "g"];
    layoutTwoRows(input);
    expect(input).toHaveLength(7);
  });
});
