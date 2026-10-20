import type { MouseEvent } from "react";
import { Minus, Square, X } from "lucide-react";

import { tryGetCurrentWindow } from "@/utils/appWindow";

type AppWindow = NonNullable<ReturnType<typeof tryGetCurrentWindow>>;

/**
 * 浏览器里（`pnpm desktop:dev` 的纯 UI 调试）拿不到窗口句柄，
 * 三个窗口按钮与拖拽区统一降级为无操作，而不是抛错把整页打白。
 */
const appWindow = tryGetCurrentWindow();

function runWindowCommand(command: (win: AppWindow) => Promise<void>) {
  if (!appWindow) return;
  void command(appWindow).catch(() => undefined);
}

export function AppTitleBar() {
  const handleDragStart = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    runWindowCommand((win) => win.startDragging());
  };

  const handleToggleMaximize = () => {
    runWindowCommand((win) => win.toggleMaximize());
  };

  return (
    <header className="af-window-titlebar" aria-label="窗口标题栏">
      <div
        className="af-window-drag-region"
        data-tauri-drag-region
        onMouseDown={handleDragStart}
        onDoubleClick={handleToggleMaximize}
      >
        <span className="af-window-app-mark" aria-hidden="true" />
        <span className="af-window-title">AuralFlow</span>
      </div>

      <div className="af-window-controls" aria-label="窗口控制">
        <button
          type="button"
          className="af-window-control"
          onClick={() => runWindowCommand((win) => win.minimize())}
          aria-label="最小化窗口"
          data-tooltip="最小化" data-tooltip-placement="bottom-end"
        >
          <Minus size={14} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          className="af-window-control"
          onClick={handleToggleMaximize}
          aria-label="最大化或还原窗口"
          data-tooltip="最大化或还原" data-tooltip-placement="bottom-end"
        >
          <Square size={12} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          className="af-window-control af-window-control-close"
          onClick={() => runWindowCommand((win) => win.close())}
          aria-label="关闭窗口"
          data-tooltip="关闭" data-tooltip-placement="bottom-end"
        >
          <X size={15} strokeWidth={2.3} />
        </button>
      </div>
    </header>
  );
}
