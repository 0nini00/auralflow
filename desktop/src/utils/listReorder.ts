/**
 * 列表拖动重排的纯函数：落点计算与真正的移动共用同一套下标语义，
 * 避免「指针算出的位置」和「store 里 remove→insert 的位置」错位。
 */

export interface ReorderAnchor {
  top: number;
  height: number;
}

/**
 * 指针落在哪一格：逐张卡片比较竖向中点，返回插入下标。
 * anchors 必须是「去掉被拖动项之后」的顺序，返回值即可直接交给 moveItemToIndex。
 */
export function resolveDropSlot(anchors: ReorderAnchor[], clientY: number): number {
  for (let slot = 0; slot < anchors.length; slot += 1) {
    const anchor = anchors[slot];
    if (clientY < anchor.top + anchor.height / 2) return slot;
  }
  return anchors.length;
}

/**
 * 把 from 位置的元素移动到 to 位置（先移除再插入），to 越界会夹到合法范围。
 * 下标相同时原样返回同一个数组引用，调用方可以据此跳过无意义的写入。
 */
export function moveItemToIndex<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return items;
  const target = Math.max(0, Math.min(Math.round(to), items.length - 1));
  if (target === from) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}
