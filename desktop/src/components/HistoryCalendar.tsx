import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, dayStartOf, getMonthCalendarDays } from "@lx/core";

interface HistoryCalendarProps {
  /** 有播放记录的本地日 00:00 时间戳 */
  recordedDays: readonly number[];
  selectedDay: number;
  onSelect: (dayStart: number) => void;
  onClose: () => void;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 历史日历：只允许选到今天为止、且确实有播放记录的日期。
 * 逻辑口径与移动端 `HistoryCalendar` 一致（`getMonthCalendarDays` 在 @lx/core）。
 */
export function HistoryCalendar({ recordedDays, selectedDay, onSelect, onClose }: HistoryCalendarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const now = useMemo(() => Date.now(), []);
  const [month, setMonth] = useState(() => dayStartOf(selectedDay > 0 ? selectedDay : now));
  const recorded = useMemo(() => new Set(recordedDays.map(dayStartOf)), [recordedDays]);
  const cells = useMemo(
    () => getMonthCalendarDays(recordedDays, month, selectedDay, now),
    [recordedDays, month, selectedDay, now],
  );
  const nextMonth = addMonths(month, 1);
  const canGoNextMonth = nextMonth <= dayStartOf(now);
  const label = `${new Date(month).getFullYear()}年${new Date(month).getMonth() + 1}月`;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="af-history-calendar" ref={rootRef} role="dialog" aria-label="选择历史日期">
      <div className="af-history-calendar-head">
        <button
          type="button"
          className="af-history-calendar-nav"
          aria-label="上个月"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="af-history-calendar-label">{label}</span>
        <button
          type="button"
          className="af-history-calendar-nav"
          aria-label="下个月"
          disabled={!canGoNextMonth}
          onClick={() => canGoNextMonth && setMonth(nextMonth)}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="af-history-calendar-week" aria-hidden="true">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>

      <div className="af-history-calendar-grid">
        {cells.map((cell, index) => {
          if (!cell) return <span key={`blank-${index}`} aria-hidden="true" />;
          const day = new Date(cell.dayStart).getDate();
          const hasRecord = recorded.has(cell.dayStart);
          return (
            <button
              key={cell.dayStart}
              type="button"
              className={`af-history-calendar-cell${cell.selected ? " is-selected" : ""}${hasRecord ? " has-record" : ""}`}
              disabled={cell.disabled}
              aria-pressed={cell.selected}
              aria-label={`${new Date(cell.dayStart).getMonth() + 1}月${day}日${hasRecord ? "，有播放记录" : ""}`}
              onClick={() => {
                onSelect(cell.dayStart);
                onClose();
              }}
            >
              {day}
              {hasRecord && <span className="af-history-calendar-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="af-history-calendar-today"
        onClick={() => {
          onSelect(dayStartOf(now));
          onClose();
        }}
      >
        回到今天
      </button>
    </div>
  );
}
