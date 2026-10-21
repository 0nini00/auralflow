import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { PlayerBar } from "../PlayerBar";
import { NowPlayingPanel } from "../NowPlayingPanel";
import { loadSettings } from "@lx/tauri-bridge";
import { useUiStore } from "@/stores/uiStore";
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
  const nowPlayingOpen = useUiStore((s) => s.nowPlayingOpen);
  const location = useLocation();
  // 搜索页自带一个主搜索框，顶栏那个在这页会变成重复入口，收起
  const isSearchRoute = location.pathname === "/search";

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
    <div className={`af-app ${appBackgroundImageUrl ? "af-app-has-background" : ""} ${isSearchRoute ? "af-route-search" : ""}`}>
      {appBackgroundImageUrl && (
        <div
          className="af-app-background"
          style={{ backgroundImage: `url("${appBackgroundImageUrl}")` }}
          aria-hidden="true"
        />
      )}
      <div className="af-main-container">
        <Sidebar />
        <div className="af-workspace">
          <Topbar />
          <div className={`af-stage ${nowPlayingOpen ? "af-stage-with-panel" : ""}`}>
            <main className="af-content">
              <div className="af-content-scroll">
                <Outlet />
              </div>
            </main>
            {nowPlayingOpen && <NowPlayingPanel />}
          </div>
        </div>
      </div>
      <PlayerBar />
    </div>
  );
}
