import { useState, useRef, useEffect, useCallback } from "react";

interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  className?: string;
  /** 可选：滚动到指定 index */
  scrollToIndex?: number;
  /** 可选：强制重新触发滚动定位 */
  scrollToKey?: number | string;
  /** 可选：滚动事件回调（用于关闭 portal 菜单等） */
  onScroll?: () => void;
  /** 可选：使用外层滚动容器，列表自身只负责撑开内容高度 */
  scrollRootSelector?: string;
}

/**
 * 轻量固定行高虚拟列表：只渲染可见区域 + overscan 行。
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
  onScroll,
  scrollRootSelector,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onScrollRef = useRef(onScroll);

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
    if (scrollToIndex == null || scrollToIndex < 0) return;
    const el = containerRef.current;
    if (!el) return;
    const top = scrollToIndex * rowHeight;
    if (scrollRootSelector) {
      const root = getScrollRoot();
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const listTop = root.scrollTop + elRect.top - rootRect.top;
      root.scrollTo({ top: listTop + top, behavior: "smooth" });
      return;
    }
    el.scrollTo({ top, behavior: "smooth" });
  }, [getScrollRoot, rowHeight, scrollRootSelector, scrollToIndex, scrollToKey]);

  const total = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportH / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);
  const slice = items.slice(start, end);

  return (
    <div
      ref={containerRef}
      className={`af-virtual-list${scrollRootSelector ? " af-virtual-list-external" : ""} ${className ?? ""}`}
      onScroll={scrollRootSelector ? undefined : onScrollInternal}
    >
      <div style={{ height: total, position: "relative" }}>
        {slice.map((item, i) => {
          const index = start + i;
          return (
            <div
              key={index}
              style={{
                position: "absolute",
                top: index * rowHeight,
                left: 0,
                right: 0,
                height: rowHeight,
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
