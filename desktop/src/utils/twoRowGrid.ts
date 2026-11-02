/**
 * 「固定两行、横向铺满」的网格布局计算。
 *
 * 首页的推荐歌单与排行榜两块卡片区都用它：列数由条目数算出（`ceil(n / 2)`），
 * 窗口缩放只改变卡片大小，行数永远是两行。此前用 CSS `auto-fill` + `minmax()`，
 * 宽屏会排成一行、窄屏会排成三行，同一屏里两块区的行数还会不一致。
 *
 * 条目数为奇数且足够多（≥ 6）时丢掉最后一条：两行必须等长，末尾才不会留空位；
 * 两块的标题右侧都有「更多」入口，少一条不影响可达性。短列表（≤ 5）不丢——
 * 那种情况下要多排一行的是内容本身，删数据只会让人少看到东西。
 */
export interface TwoRowGridLayout<T> {
  items: T[];
  columns: number;
}

/** 低于这个条目数就不为「两行等长」删数据。 */
const MIN_ITEMS_TO_DROP_ODD = 6;

export function layoutTwoRows<T>(items: readonly T[]): TwoRowGridLayout<T> {
  const dropLast =
    items.length >= MIN_ITEMS_TO_DROP_ODD && items.length % 2 === 1;
  const kept = dropLast ? items.slice(0, -1) : [...items];
  return { items: kept, columns: Math.max(1, Math.ceil(kept.length / 2)) };
}
