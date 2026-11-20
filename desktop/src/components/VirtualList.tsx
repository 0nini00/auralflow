import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";

interface VirtualListProps<T> {
  items: readonly T[];
  rowHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  className?: string;
  /** 可选：滚动到指定 index */
  scrollToIndex?: number;
  /** 可选：强制重新触发滚动定位 */
  scrollToKey?: number | string;
  scrollBehavior?: ScrollBehavior;
  scrollAlign?: 'start' | 'center';
  /** 可选：滚动事件回调（用于关闭 portal 菜单等） */
  onScroll?: () => void;
  /** 可选：使用外层滚动容器，列表自身只负责撑开内容高度 */
  scrollRootSelector?: string;
  /**
   * 可选：行身份 key，默认用下标。
   *
   * 列表会被过滤/重排且行内有状态（展开的菜单、内联编辑）时传入，
   * 例：`` `${item.id}:${index}` ``（不要只用 id：队列里允许同一首歌出现多次，
   * 纯 id 会撞 key）。
   */
  getItemKey?: (item: T, index: number) => string | number;
  /** 以 rowHeight 预估，随后按实际内容高度定位，支持换行与状态提示。 */
  measureRows?: boolean;
  /** 结果行选择器；方向键、Home、End 跨虚拟窗口移动焦点。 */
  keyboardItemSelector?: string;
}

/**
 * 只渲染可见区域 + overscan 行；默认固定行高，可按实际内容测量。
 * 默认使用自身滚动；传入 scrollRootSelector 时跟随外层容器滚动。
 */
export function VirtualList<T>({
  items,
  rowHeight,
  renderItem,
  overscan = 6,
  className,
  scrollToIndex,
  scrollToKey,
  scrollBehavior = 'smooth',
  scrollAlign = 'start',
  onScroll,
  scrollRootSelector,
  getItemKey,
  measureRows = false,
  keyboardItemSelector,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onScrollRef = useRef(onScroll);
  const [heights, setHeights] = useState<Map<string | number, number>>(() => new Map());
  const [keyboardTarget, setKeyboardTarget] = useState<{ index: number } | null>(null);
  const keys = useMemo(() => items.map((item, index) => getItemKey ? getItemKey(item, index) : index), [getItemKey, items]);
  const offsets = useMemo(() => {
    if (!measureRows) return null;
    const result = [0];
    for (const key of keys) result.push(result[result.length - 1] + (heights.get(key) ?? rowHeight));
    return result;
  }, [heights, keys, measureRows, rowHeight]);
  const itemTop = useCallback((index: number) => offsets?.[index] ?? index * rowHeight, [offsets, rowHeight]);

  useEffect(() => {
    onScrollRef.current = onScroll;
  }, [onScroll]);

  const getScrollRoot = useCallback(() => {
    const el = containerRef.current;
    if (!el || !scrollRootSelector) return null;
    return el.closest(scrollRootSelector) as HTMLElement | null;
  }, [scrollRootSelector]);

  const measureExternalScroll = useCallback(() => {
    const el = containerRef.current;
    const root = getScrollRoot();
    if (!el || !root) return;

    const rootRect = root.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const listTop = root.scrollTop + elRect.top - rootRect.top;

    setScrollTop(Math.max(0, root.scrollTop - listTop));
    setViewportH(root.clientHeight);
  }, [getScrollRoot]);

  const onScrollInternal = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    onScrollRef.current?.();
  }, []);

  useEffect(() => {
    if (scrollRootSelector) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    setViewportH(el.clientHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRootSelector]);

  useEffect(() => {
    if (!scrollRootSelector) return;
    const el = containerRef.current;
    const root = getScrollRoot();
    if (!el || !root) return;

    const handleScroll = () => {
      measureExternalScroll();
      onScrollRef.current?.();
    };
    const ro = new ResizeObserver(measureExternalScroll);

    setScrollTop(0);
    measureExternalScroll();
    ro.observe(root);
    ro.observe(el);
    root.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      ro.disconnect();
      root.removeEventListener("scroll", handleScroll);
    };
  }, [getScrollRoot, measureExternalScroll, scrollRootSelector]);

  useEffect(() => {
    const targetIndex = keyboardTarget?.index ?? scrollToIndex;
    if (targetIndex == null || targetIndex < 0) return;
    const el = containerRef.current;
    if (!el) return;
    const root = scrollRootSelector ? getScrollRoot() : null;
    // 外层滚动容器还没就位时不定位，等它挂上后这个 effect 会带着同一个 index 重跑。
    if (scrollRootSelector && !root) return;
    const viewport = (root ? root.clientHeight : el.clientHeight) ?? 0;
    const centering = scrollAlign === 'center' ? Math.max(0, viewport - rowHeight) / 2 : 0;
    const top = Math.max(0, itemTop(targetIndex) - centering);
    if (root) {
      const rootRect = root.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const listTop = root.scrollTop + elRect.top - rootRect.top;
      if (keyboardTarget || scrollBehavior === 'auto') root.scrollTop = listTop + top;
      else root.scrollTo({ top: listTop + top, behavior: scrollBehavior });
    } else if (keyboardTarget || scrollBehavior === 'auto') {
      el.scrollTop = top;
    } else {
      el.scrollTo({ top, behavior: scrollBehavior });
    }
    // 顺手把虚拟窗口挪到目标行：滚动事件要等下一帧才回传（被合并或延迟时更晚），
    // 只依赖事件会让定位慢一帧 —— 这一帧渲染的还是列表顶部，表现为「打开先闪一下顶部再跳」。
    setScrollTop(top);
  }, [getScrollRoot, itemTop, keyboardTarget, rowHeight, scrollRootSelector, scrollToIndex, scrollToKey, scrollAlign, scrollBehavior]);

  const total = itemTop(items.length);
  const indexAt = (position: number) => {
    if (!offsets) return Math.floor(position / rowHeight);
    let low = 0, high = items.length;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (offsets[mid] <= position) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  const start = Math.max(0, Math.min(items.length - 1, indexAt(scrollTop)) - overscan);
  const end = Math.min(items.length, measureRows
    ? indexAt(scrollTop + viewportH) + overscan + 1
    : start + Math.ceil(viewportH / rowHeight) + overscan * 2);
  const slice = items.slice(start, end);

  useLayoutEffect(() => {
    if (!measureRows || !containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      setHeights(current => {
        let next = current;
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.virtualIndex);
          const key = keys[index];
          const height = entry.contentRect.height;
          if (key === undefined || !Number.isFinite(index) || height <= 0 || current.get(key) === height) continue;
          if (next === current) next = new Map(current);
          next.set(key, height);
        }
        return next;
      });
    });
    containerRef.current.querySelectorAll('[data-virtual-index]').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [end, keys, measureRows, start]);

  useLayoutEffect(() => {
    if (!keyboardTarget || !keyboardItemSelector) return;
    const target = containerRef.current?.querySelector<HTMLElement>(`[data-virtual-index="${keyboardTarget.index}"] ${keyboardItemSelector}`);
    if (!target) return;
    target.focus({ preventScroll: true });
    setKeyboardTarget(null);
  }, [end, keyboardItemSelector, keyboardTarget, start]);

  return (
    <div
      ref={containerRef}
      className={`af-virtual-list${scrollRootSelector ? " af-virtual-list-external" : ""} ${className ?? ""}`}
      onScroll={scrollRootSelector ? undefined : onScrollInternal}
      onKeyDown={event => {
        if (!keyboardItemSelector || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const row = (event.target as HTMLElement).closest<HTMLElement>(keyboardItemSelector);
        if (!row || row !== event.target || !items.length) return;
        const index = Number(row.closest<HTMLElement>('[data-virtual-index]')?.dataset.virtualIndex);
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : Math.min(items.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
        setKeyboardTarget({ index: next });
      }}
    >
      <div style={{ height: total, position: "relative" }}>
        {slice.map((item, i) => {
          const index = start + i;
          return (
            <div
              key={keys[index]}
              data-virtual-index={index}
              style={{
                position: "absolute",
                top: itemTop(index),
                left: 0,
                right: 0,
                height: measureRows ? undefined : rowHeight,
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
