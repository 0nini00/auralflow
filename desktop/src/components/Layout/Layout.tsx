import { Outlet } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { PlayerBar } from "../PlayerBar";
import { AppTitleBar } from "./AppTitleBar";
import { loadSettings } from "@lx/tauri-bridge";
import {
  APP_BACKGROUND_CHANGE_EVENT,
  cacheAppBackgroundPath,
  type AppBackgroundChangeDetail,
  normalizeAppBackgroundPath,
  readCachedAppBackgroundPath,
  toAppBackgroundImageUrl,
} from "@/services/appBackground";

export function Layout() {
  const [appBackgroundImagePath, setAppBackgroundImagePath] = useState<string | null>(
    () => readCachedAppBackgroundPath() ?? null,
  );
  const appBackgroundImageUrl = useMemo(
    () => toAppBackgroundImageUrl(appBackgroundImagePath),
    [appBackgroundImagePath],
  );

  useEffect(() => {
    loadSettings()
      .then((settings) => {
        const path = normalizeAppBackgroundPath(settings.appBackgroundImagePath);
        cacheAppBackgroundPath(path);
        setAppBackgroundImagePath(path);
      })
      .catch((error) => {
        console.error("读取应用背景设置失败", error);
      });

    const handleBackgroundChange = (event: Event) => {
      const detail = (event as CustomEvent<AppBackgroundChangeDetail>).detail;
      setAppBackgroundImagePath(normalizeAppBackgroundPath(detail?.path));
    };
    window.addEventListener(APP_BACKGROUND_CHANGE_EVENT, handleBackgroundChange);
    return () => window.removeEventListener(APP_BACKGROUND_CHANGE_EVENT, handleBackgroundChange);
  }, []);

  return (
    <div className={`af-app ${appBackgroundImageUrl ? "af-app-has-background" : ""}`}>
      {appBackgroundImageUrl && (
        <div
          className="af-app-background"
          style={{ backgroundImage: `url("${appBackgroundImageUrl}")` }}
          aria-hidden="true"
        />
      )}
      <AppTitleBar />
      <div className="af-main-container">
        <Sidebar />
        <div className="af-workspace">
          <Header />
          <main className="af-content">
            <div className="af-content-scroll">
              <Outlet />
            </div>
          </main>
          <PlayerBar />
        </div>
      </div>
    </div>
  );
}
