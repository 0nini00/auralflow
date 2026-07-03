import { Outlet } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { PlayerBar } from "../PlayerBar";
import { AppTitleBar } from "./AppTitleBar";
import { loadSettings } from "@lx/tauri-bridge";
import {
  APP_BACKGROUND_CHANGE_EVENT,
  type AppBackgroundChangeDetail,
  normalizeAppBackgroundPath,
  toAppBackgroundImageUrl,
} from "@/services/appBackground";
import { logAsyncError } from "@/utils/logAsyncError";

export function Layout() {
  const [appBackgroundImagePath, setAppBackgroundImagePath] = useState<string | null>(null);
  const appBackgroundImageUrl = useMemo(
    () => toAppBackgroundImageUrl(appBackgroundImagePath),
    [appBackgroundImagePath],
  );

  useEffect(() => {
    loadSettings()
      .then((settings) => setAppBackgroundImagePath(normalizeAppBackgroundPath(settings.appBackgroundImagePath)))
      .catch(logAsyncError("layout:load-app-background"));

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
