const test = require("node:test");
const assert = require("node:assert/strict");

const { createLoader } = require("./helpers/loadTs.cjs");

const model = createLoader({})("src/services/sourceReorderModel.ts");

// 三张等高卡片，间距 0：中心 50 / 150 / 250
const equalRows = [
  { y: 0, height: 100 },
  { y: 100, height: 100 },
  { y: 200, height: 100 },
];

// 高度不等 + 12px 间距：中心 60 / 228 / 376
const mixedRows = [
  { y: 0, height: 120 },
  { y: 132, height: 192 },
  { y: 336, height: 80 },
];

test("等高卡片：拖过一半高度才换位", () => {
  assert.equal(model.getSourceDropIndex(equalRows, 0, 0), 0);
  assert.equal(model.getSourceDropIndex(equalRows, 0, 50), 0);
  assert.equal(model.getSourceDropIndex(equalRows, 0, 51), 1);
  assert.equal(model.getSourceDropIndex(equalRows, 0, 151), 2);
  assert.equal(model.getSourceDropIndex(equalRows, 2, -51), 1);
  assert.equal(model.getSourceDropIndex(equalRows, 2, -151), 0);
});

test("不等高卡片：按相邻卡片中心的中点落位", () => {
  // 边界 1：(60 + 228) / 2 = 144
  assert.equal(model.getSourceDropIndex(mixedRows, 0, 83), 0);
  assert.equal(model.getSourceDropIndex(mixedRows, 0, 85), 1);
  // 边界 2：(228 + 376) / 2 = 302，卡片 0 中心 60 需要拖 243
  assert.equal(model.getSourceDropIndex(mixedRows, 0, 241), 1);
  assert.equal(model.getSourceDropIndex(mixedRows, 0, 243), 2);
  // 从底部往上：卡片 2 中心 376，边界 302，拖过 75 才越过
  assert.equal(model.getSourceDropIndex(mixedRows, 2, -74), 2);
  assert.equal(model.getSourceDropIndex(mixedRows, 2, -76), 1);
});

test("非法索引与非法位移原样返回", () => {
  assert.equal(model.getSourceDropIndex([], 0, 40), 0);
  assert.equal(model.getSourceDropIndex(equalRows, -1, 40), -1);
  assert.equal(model.getSourceDropIndex(equalRows, 3, 40), 3);
  assert.equal(model.getSourceDropIndex(equalRows, 1, Number.NaN), 1);
});

test("让位位移包含卡片间距", () => {
  assert.equal(model.getSourceRowShift(1, 0, 2, mixedRows, 12), -132);
  assert.equal(model.getSourceRowShift(2, 0, 2, mixedRows, 12), -132);
  assert.equal(model.getSourceRowShift(0, 2, 0, mixedRows, 12), 92);
  assert.equal(model.getSourceRowShift(1, 2, 0, mixedRows, 12), 92);
  assert.equal(model.getSourceRowShift(1, 1, 1, mixedRows, 12), 0);
  assert.equal(model.getSourceRowShift(0, 0, 2, mixedRows, 12), 0);
  assert.equal(model.getSourceRowShift(9, 0, 2, mixedRows, 12), 0);
});

test("命中卡片与落在间距时取最近一张", () => {
  assert.equal(model.findSourceRowAt(mixedRows, 10), 0);
  assert.equal(model.findSourceRowAt(mixedRows, 200), 1);
  assert.equal(model.findSourceRowAt(mixedRows, 400), 2);
  // 124 落在 120~132 的间距里，离卡片 0 更近
  assert.equal(model.findSourceRowAt(mixedRows, 124), 0);
  assert.equal(model.findSourceRowAt(mixedRows, 130), 1);
  assert.equal(model.findSourceRowAt([], 10), -1);
});

test("边缘自动滚动按距离加速并夹在内容范围内", () => {
  // 视口中部不滚
  assert.equal(model.getSourceAutoScrollOffset(400, 800, 200, 2000, 16), 200);
  // 顶部边缘：方向 -1，520 * 16 / 1000 = 8.32
  assert.ok(Math.abs(model.getSourceAutoScrollOffset(0, 800, 200, 2000, 16) - (200 - 8.32)) < 1e-9);
  // 底部边缘同速反向
  assert.ok(Math.abs(model.getSourceAutoScrollOffset(800, 800, 200, 2000, 16) - (200 + 8.32)) < 1e-9);
  // 顶部夹到 0；单帧时间封顶 32ms
  assert.equal(model.getSourceAutoScrollOffset(0, 800, 4, 2000, 100), 0);
  // 底部夹到 contentHeight - height
  assert.equal(model.getSourceAutoScrollOffset(800, 800, 199, 1000, 32), 200);
  // 未测量出视口时不滚
  assert.equal(model.getSourceAutoScrollOffset(0, 0, 120, 2000, 16), 120);
});

test("槽位搬移：越界不抛错", () => {
  const items = ["a", "b", "c"];
  assert.deepEqual(model.moveSourceItem(items, 0, 2), ["b", "c", "a"]);
  assert.deepEqual(model.moveSourceItem(items, 2, 0), ["c", "a", "b"]);
  assert.deepEqual(model.moveSourceItem(items, 1, 1), ["a", "b", "c"]);
  assert.deepEqual(model.moveSourceItem(items, -1, 0), ["a", "b", "c"]);
  assert.deepEqual(model.moveSourceItem(items, 0, 3), ["a", "b", "c"]);
  // 原数组不被修改
  assert.deepEqual(items, ["a", "b", "c"]);
});
