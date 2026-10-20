import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 安全取当前窗口句柄；非 Tauri 环境下返回 `null`。
 *
 * 为什么需要它：`pnpm desktop:dev` 标称「仅启动前端，用于纯 UI 调试」，但在普通浏览器里
 * 没有 `window.__TAURI_INTERNALS__`，`getCurrentWindow()` 会抛
 * `TypeError: Cannot read properties of undefined (reading 'metadata')`。
 * 调用点只要在模块顶层或 render 里（`AppTitleBar`、`App`、`main`），一抛就是整页白屏，
 * 于是「纯 UI 调试」实际不可用。
 *
 * 统一在这里降级成 `null`，由调用方跳过窗口操作，而不是每处各写一遍 try/catch。
 */
export function tryGetCurrentWindow(): ReturnType<typeof getCurrentWindow> | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}
