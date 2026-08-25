import type { MouseEvent } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

function runWindowCommand(command: () => Promise<void>) {
  void command().catch(() => undefined);
}

export function AppTitleBar() {
  const handleDragStart = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    runWindowCommand(() => appWindow.startDragging());
  };

  const handleToggleMaximize = () => {
    runWindowCommand(() => appWindow.toggleMaximize());
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
          onClick={() => runWindowCommand(() => appWindow.minimize())}
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
          onClick={() => runWindowCommand(() => appWindow.close())}
          aria-label="关闭窗口"
          data-tooltip="关闭" data-tooltip-placement="bottom-end"
        >
          <X size={15} strokeWidth={2.3} />
        </button>
      </div>
    </header>
  );
}
