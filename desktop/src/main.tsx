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

// Initialize theme
import { applyInitialAppearance } from "./stores/themeStore";
applyInitialAppearance();

// 未捕获异常与未处理的 Promise 拒绝进日志（文件日志由 Rust 侧 tauri-plugin-log 落盘）
installGlobalErrorHandlers();

// 浏览器里（`pnpm desktop:dev` 的纯 UI 调试）没有 Tauri 运行时，
// tryGetCurrentWindow 会降级成 null，窗口角色按「主窗口」处理。
const appWindow = tryGetCurrentWindow();
const windowRole = detectWindowRoleFromParts(appWindow?.label, window.location.hash);

async function prepareMainWindowBackground() {
  if (windowRole !== "main") return;

  await prepareInitialAppBackground({
    loadPersistedPath: async () => (await loadSettings()).appBackgroundImagePath,
  });
}

async function startApp() {
  try {
    await prepareMainWindowBackground();
  } catch (error) {
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
  if (windowRole === "main" && appWindow) {
    await appWindow.show();
  }
}

void startApp();
