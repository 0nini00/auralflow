import React from "react";
import ReactDOM from "react-dom/client";
import { tryGetCurrentWindow } from "@/utils/appWindow";
import { loadSettings } from "@lx/tauri-bridge";

import App from "./App";
import { prepareInitialAppBackground } from "./services/appBackground";
import { installGlobalErrorHandlers } from "./services/logger";
import { detectWindowRoleFromParts } from "./utils/windowRole";
import "./index.css";
import "./styles/theme.css";
import "./styles/empty-state.css";
import "./styles/layout.css";
import "./styles/player.css";
import "./styles/home.css";
import "./styles/discover.css";
import "./styles/local-music.css";
import "./styles/search.css";
import "./styles/settings.css";
import "./styles/playlists.css";
import "./styles/stats.css";
import "./styles/buttons.css";
import "./styles/tooltip.css";
import "./styles/toast.css";

// Initialize theme
import { applyInitialAppearance } from "./stores/themeStore";
applyInitialAppearance();

// 未捕获异常与未处理的 Promise 拒绝进日志（文件日志由 Rust 侧 tauri-plugin-log 落盘）
installGlobalErrorHandlers();

// 屏蔽 WebView 自带的浏览器右键菜单（返回 / 刷新 / 另存为…）：这是桌面应用，
// 这些动作在这里没有意义。可编辑控件（输入框 / 文本域 / 可编辑区域）保留默认菜单，
// 否则连带右键粘贴也一起没了。
function isEditableContextTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== "function") return false;
  return element.closest("input, textarea, [contenteditable]:not([contenteditable='false'])") !== null;
}

window.addEventListener("contextmenu", (event) => {
  if (isEditableContextTarget(event.target)) return;
  event.preventDefault();
});

// 浏览器里（`pnpm desktop:dev` 的纯 UI 调试）没有 Tauri 运行时，
// tryGetCurrentWindow 会降级成 null，窗口角色按「主窗口」处理。
const appWindow = tryGetCurrentWindow();
const windowRole = detectWindowRoleFromParts(appWindow?.label, window.location.hash);

async function prepareMainWindowBackground(): Promise<boolean> {
  if (windowRole !== "main") return false;

  const settings = await loadSettings();
  await prepareInitialAppBackground({
    loadPersistedPath: async () => settings.appBackgroundImagePath,
  });
  return settings.startMinimized === true;
}

async function startApp() {
  let startMinimized = false;
  try {
    startMinimized = await prepareMainWindowBackground();
  } catch (error) {
    // 读设置失败时默认显示窗口，避免用户启动后看不到应用。
    console.error("启动背景预加载失败", error);
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
  // 浏览器里（`pnpm desktop:dev` 的纯 UI 调试）没有 Tauri 窗口，跳过 show()。
  if (windowRole === "main" && appWindow && !startMinimized) {
    await appWindow.show();
  }
}

void startApp();
