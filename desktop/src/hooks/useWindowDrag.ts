import type { MouseEvent } from "react";

import { tryGetCurrentWindow } from "@/utils/appWindow";

type AppWindow = NonNullable<ReturnType<typeof tryGetCurrentWindow>>;

/**
 * 浏览器里（`pnpm desktop:dev` 的纯 UI 调试）拿不到窗口句柄，
 * 拖拽区与窗口按钮统一降级为无操作，而不是抛错把整页打白。
 */
const appWindow = tryGetCurrentWindow();

export function runWindowCommand(command: (win: AppWindow) => Promise<void>) {
  if (!appWindow) return;
  void command(appWindow).catch(() => undefined);
}

/** 顶栏与侧栏品牌区共用的窗口拖拽：按下空白处拖动、双击最大化/还原。 */
export function useWindowDrag() {
  const handleMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // 按钮、输入框、链接自己的交互优先，不能当成拖拽起点
    if ((event.target as HTMLElement).closest("button, a, input, textarea, select, [role='button']")) return;
    runWindowCommand((win) => win.startDragging());
  };

  const handleDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, a, input, textarea, select, [role='button']")) return;
    runWindowCommand((win) => win.toggleMaximize());
  };

  return { onMouseDown: handleMouseDown, onDoubleClick: handleDoubleClick };
}
