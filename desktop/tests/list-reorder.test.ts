import { describe, expect, it } from "vitest";
import { moveItemToIndex, resolveDropSlot } from "../src/utils/listReorder";

const card = (top: number, height = 54) => ({ top, height });
// 三张卡片：0–54、62–116、124–178，中点分别是 27 / 89 / 151
const cards = [card(0), card(62), card(124)];

/**
 * 模拟一次拖动：anchors 只取「去掉被拖动项之后」的卡片几何，
 * 落点下标直接交给 moveItemToIndex，与设置页和 store 的真实链路一致。
 */
function applyDrop(items: string[], draggedIndex: number, clientY: number) {
  const anchors = items
    .filter((_, index) => index !== draggedIndex)
    .map((_, index) => cards[index]);
  return moveItemToIndex(items, draggedIndex, resolveDropSlot(anchors, clientY));
}

describe("resolveDropSlot", () => {
  it("指针在首张卡片上半部分时插入到最前", () => {
    expect(resolveDropSlot(cards, 10)).toBe(0);
  });

  it("指针落在两张卡片之间时返回后一张的下标", () => {
    expect(resolveDropSlot(cards, 58)).toBe(1);
    expect(resolveDropSlot(cards, 120)).toBe(2);
  });

  it("指针越过最后一张卡片中点时插入到末尾", () => {
    expect(resolveDropSlot(cards, 170)).toBe(3);
  });

  it("没有其它卡片时插入位置是 0", () => {
    expect(resolveDropSlot([], 100)).toBe(0);
  });
});

describe("moveItemToIndex", () => {
  it("先移除再插入，返回新数组且不改动原数组", () => {
    const items = ["a", "b", "c"];
    const next = moveItemToIndex(items, 0, 2);
    expect(next).toEqual(["b", "c", "a"]);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("目标下标越界时夹到首尾", () => {
    expect(moveItemToIndex(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
    expect(moveItemToIndex(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
  });

  it("下标不变或来源越界时返回同一个引用", () => {
    const items = ["a", "b", "c"];
    expect(moveItemToIndex(items, 1, 1)).toBe(items);
    expect(moveItemToIndex(items, 5, 0)).toBe(items);
  });
});

describe("拖动落点与列表移动配合", () => {
  it("把首项拖到末尾", () => {
    expect(applyDrop(["a", "b", "c"], 0, 170)).toEqual(["b", "c", "a"]);
  });

  it("把首项拖到中间", () => {
    expect(applyDrop(["a", "b", "c"], 0, 58)).toEqual(["b", "a", "c"]);
  });

  it("把末项拖到最前", () => {
    expect(applyDrop(["a", "b", "c"], 2, 10)).toEqual(["c", "a", "b"]);
  });

  it("把末项拖到中间", () => {
    expect(applyDrop(["a", "b", "c"], 2, 58)).toEqual(["a", "c", "b"]);
  });

  it("在原位松手不改顺序，也不产生新数组", () => {
    const items = ["a", "b", "c"];
    expect(applyDrop(items, 1, 30)).toBe(items);
  });
});
