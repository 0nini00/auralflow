import type { MouseEvent } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logAsyncError } from "@/utils/logAsyncError";

const appWindow = getCurrentWindow();

function runWindowCommand(command: () => Promise<void>, label: string) {
  void command().catch(logAsyncError(`window-titlebar:${label}`));
}

export function AppTitleBar() {
  const handleDragStart = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    runWindowCommand(() => appWindow.startDragging(), "start-dragging");
  };

  const handleToggleMaximize = () => {
    runWindowCommand(() => appWindow.toggleMaximize(), "toggle-maximize");
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
          onClick={() => runWindowCommand(() => appWindow.minimize(), "minimize")}
          aria-label="最小化窗口"
          title="最小化"
        >
          <Minus size={14} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          className="af-window-control"
          onClick={handleToggleMaximize}
          aria-label="最大化或还原窗口"
          title="最大化或还原"
        >
          <Square size={12} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          className="af-window-control af-window-control-close"
          onClick={() => runWindowCommand(() => appWindow.close(), "close")}
          aria-label="关闭窗口"
          title="关闭"
        >
          <X size={15} strokeWidth={2.3} />
        </button>
      </div>
    </header>
  );
}
