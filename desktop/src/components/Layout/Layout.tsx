import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { PlayerBar } from "../PlayerBar";
import { NowPlayingPanel } from "../NowPlayingPanel";
import { ErrorBoundary } from "../ErrorBoundary";
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
          {/* 右栏宽度由 .af-now-playing 自己的 flex-basis 决定；此前这里还挂了一个
              af-stage-with-panel 修饰类，但它在 CSS 里从无定义（空类），已删。 */}
          <div className="af-stage">
            <main className="af-content">
              <div className="af-content-scroll">
                {/* 路由级兜底：单个页面渲染崩掉时只废掉内容区，
                    侧栏 / 顶栏 / 播放条仍然可用（用户能切到别的页或继续听）。
                    以 pathname 作 key，切页即自动清掉错误状态，不必手动重试。 */}
                <ErrorBoundary key={location.pathname} scope={`route:${location.pathname}`}>
                  <Outlet />
                </ErrorBoundary>
              </div>
            </main>
            {/* NowPlayingPanel 同样按页隔离：它自己在渲染期抛错不该带走播放条 */}
            {nowPlayingOpen && (
              <ErrorBoundary scope="now-playing-panel">
                <NowPlayingPanel />
              </ErrorBoundary>
            )}
          </div>
        </div>
      </div>
      <PlayerBar />
    </div>
  );
}
