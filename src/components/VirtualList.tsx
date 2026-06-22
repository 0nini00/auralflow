import { useState, useRef, useEffect, useCallback } from "react";

interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  className?: string;
  /** 可选：滚动到指定 index */
  scrollToIndex?: number;
  /** 可选：滚动事件回调（用于关闭 portal 菜单等） */
  onScroll?: () => void;
}

/**
 * 轻量固定行高虚拟列表：只渲染可见区域 + overscan 行。
 * 容器需要自身有确定高度（如 flex:1 + overflow）。
 */
export function VirtualList<T>({
  items,
  rowHeight,
  renderItem,
  overscan = 6,
  className,
  scrollToIndex,
  onScroll,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onScrollInternal = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    onScroll?.();
  }, [onScroll]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    setViewportH(el.clientHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (scrollToIndex == null || scrollToIndex < 0) return;
    const el = containerRef.current;
    if (!el) return;
    const top = scrollToIndex * rowHeight;
    el.scrollTo({ top, behavior: "smooth" });
  }, [scrollToIndex, rowHeight]);

  const total = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportH / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);
  const slice = items.slice(start, end);

  return (
    <div
      ref={containerRef}
      className={`af-virtual-list ${className ?? ""}`}
      onScroll={onScrollInternal}
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
