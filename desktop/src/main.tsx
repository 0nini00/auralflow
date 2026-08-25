import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadSettings } from "@lx/tauri-bridge";

import App from "./App";
import { prepareInitialAppBackground } from "./services/appBackground";
import { detectWindowRoleFromParts } from "./utils/windowRole";
import "./index.css";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/player.css";
import "./styles/home.css";
import "./styles/local-music.css";
import "./styles/search.css";
import "./styles/settings.css";
import "./styles/playlists.css";
import "./styles/buttons.css";
import "./styles/tooltip.css";

// Initialize theme
import { applyInitialAppearance } from "./stores/themeStore";
applyInitialAppearance();

const appWindow = getCurrentWindow();
const windowRole = detectWindowRoleFromParts(appWindow.label, window.location.hash);

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
  if (windowRole === "main") {
    await appWindow.show();
  }
}

void startApp();
