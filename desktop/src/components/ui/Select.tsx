import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { getSelectMenuPosition, type SelectMenuPosition } from "@/utils/menuPosition";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  /** 控件名称：触发器读作「名称：当前选项」，菜单读作名称 */
  label: string;
  options: ReadonlyArray<SelectOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** 触发器的外观由使用场景决定（设置行 / 深色详情头部），这里不带默认样式 */
  triggerClassName: string;
  disabled?: boolean;
}

/**
 * 自绘下拉选择：触发按钮 + portal 到 body 的菜单。
 *
 * 不用原生 <select>：它的箭头与展开列表都由系统绘制，底色、圆角、选中态都跟不上主题。
 * 菜单沿用全站 portal 菜单的做法（.af-add-menu-backdrop + .af-dropdown-menu），
 * 键盘行为按原生下拉补齐：方向键 / Home / End 移动，Enter / 空格选中，Esc / Tab 收起。
 */
export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  triggerClassName,
  disabled = false,
}: SelectProps<T>) {
  const [position, setPosition] = useState<SelectMenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const open = position !== null;

  const openMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    setPosition(getSelectMenuPosition(
      event.currentTarget.getBoundingClientRect(),
      options.length,
      { width: window.innerWidth, height: window.innerHeight },
    ));
  };

  // 每条关闭路径都把焦点还给触发器，否则焦点落回 body，下一次 Tab 要从文档开头重新数。
  // preventScroll：因页面滚动而关闭时，不能再把页面拽回触发器所在的位置。
  const close = useCallback(() => {
    setPosition(null);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  // 菜单固定定位在 body 上，不随内容滚动，所以 Esc / 点空白 / 滚动三条路都要能关；
  // 但它自己超长时内部要能滚，那种滚动不能把菜单关掉。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".af-dropdown-menu")) return;
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      // 不拦默认行为：焦点先回到触发器，浏览器再从触发器走到相邻控件，与原生下拉一致
      close();
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const current = items.indexOf(event.target as HTMLButtonElement);
    const targets: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (!(event.key in targets)) return;
    event.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, targets[event.key]))]?.focus();
  };

  const selectedIndex = options.findIndex((option) => option.value === value);
  // 值不在选项里（旧存档、已下线的选项）时原样显示，不伪装成第一项
  const selectedLabel = selectedIndex >= 0 ? options[selectedIndex].label : value;
  // 展开后焦点落在当前项上；没有当前项就落在第一项，键盘才有起点
  const focusIndex = Math.max(0, selectedIndex);

  const choose = (next: T) => {
    if (next !== value) onChange(next);
    close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        onClick={openMenu}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}：${selectedLabel}`}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {position && createPortal(
        <>
          <div className="af-add-menu-backdrop" onClick={close} aria-hidden="true" />
          <div
            className="af-dropdown-menu"
            role="menu"
            aria-label={label}
            style={{
              position: "fixed",
              ...position,
              marginTop: 0,
              overflowY: "auto",
              overscrollBehavior: "contain",
              zIndex: 9999,
            }}
            onKeyDown={onMenuKeyDown}
          >
            {options.map((option, index) => {
              const checked = index === selectedIndex;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  autoFocus={index === focusIndex}
                  className="af-select-option"
                  onClick={() => choose(option.value)}
                >
                  <span>{option.label}</span>
                  {checked && <Check size={14} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
