/**
 * 音源卡片拖拽排序的纯计算。
 *
 * 音源卡高度不固定（测试结果、更新提示、更新地址都会把卡片撑高），
 * 所以不能套用固定行高的队列排序公式：
 * - 落位：比较被拖卡片中心与相邻卡片中心的**中点**（拖过一半就换位）；
 * - 让位：按被拖卡片的实际高度 + 卡片间距平移其余卡片。
 */

export interface ReorderLayout {
  /** 卡片在列表容器内的纵向偏移 */
  y: number;
  /** 卡片高度（不含卡片间距） */
  height: number;
}

const AUTO_SCROLL_EDGE = 64;
const AUTO_SCROLL_SPEED = 520;
const MAX_FRAME_MS = 32;

/**
 * 根据被拖卡片的纵向位移计算应落到的槽位。
 * `translation` 是相对按下位置的位移（已折算页面滚动量）。
 */
export function getSourceDropIndex(
  layouts: readonly ReorderLayout[],
  from: number,
  translation: number,
): number {
  "worklet";
  const count = layouts.length;
  if (from < 0 || from >= count) return from;
  if (!Number.isFinite(translation)) return from;
  const center = (index: number) => layouts[index].y + layouts[index].height / 2;
  const draggedCenter = center(from) + translation;
  let target = from;
  while (target < count - 1 && draggedCenter > (center(target) + center(target + 1)) / 2) {
    target += 1;
  }
  while (target > 0 && draggedCenter < (center(target - 1) + center(target)) / 2) {
    target -= 1;
  }
  return target;
}

/**
 * 其余卡片为了让出落位空间需要平移的距离。
 * 间距也要算进去，否则让位后会残留一条 gap 的错位。
 */
export function getSourceRowShift(
  index: number,
  from: number,
  to: number,
  layouts: readonly ReorderLayout[],
  gap: number,
): number {
  "worklet";
  if (from < 0 || from === to || index === from) return 0;
  if (index < 0 || index >= layouts.length || from >= layouts.length) return 0;
  const step = layouts[from].height + gap;
  if (from < to && index > from && index <= to) return -step;
  if (from > to && index >= to && index < from) return step;
  return 0;
}

/** 手指落在哪张卡片上；落在卡片间距时取最近的一张。 */
export function findSourceRowAt(layouts: readonly ReorderLayout[], y: number): number {
  "worklet";
  if (layouts.length === 0 || !Number.isFinite(y)) return -1;
  for (let index = 0; index < layouts.length; index += 1) {
    const row = layouts[index];
    if (y >= row.y && y <= row.y + row.height) return index;
  }
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < layouts.length; index += 1) {
    const row = layouts[index];
    const distance = y < row.y ? row.y - y : y - (row.y + row.height);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  }
  return nearest;
}

/**
 * 拖到列表上下边缘时自动滚动页面。
 * `pointerY` 是相对可视区顶部的坐标；返回新的滚动偏移（已夹在内容范围内）。
 */
export function getSourceAutoScrollOffset(
  pointerY: number,
  height: number,
  offset: number,
  contentHeight: number,
  elapsedMs: number,
): number {
  "worklet";
  if (height <= 0 || contentHeight <= 0) return offset;
  const edge = Math.min(AUTO_SCROLL_EDGE, height / 3);
  const direction = pointerY < edge
    ? -Math.min(1, (edge - pointerY) / edge)
    : pointerY > height - edge
      ? Math.min(1, (pointerY - height + edge) / edge)
      : 0;
  const delta = direction * AUTO_SCROLL_SPEED * Math.min(elapsedMs, MAX_FRAME_MS) / 1000;
  return Math.max(0, Math.min(Math.max(0, contentHeight - height), offset + delta));
}

/** 按槽位搬移元素；索引越界时原样返回（不抛错，拖拽中断也能安全落库）。 */
export function moveSourceItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from === to) return next;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return next;
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
