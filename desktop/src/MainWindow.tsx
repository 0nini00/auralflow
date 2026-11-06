import { lazy, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { showToast, ToastHost } from "@/components/ui/Toast";
import { listen } from "@tauri-apps/api/event";
import { Layout } from "./components/Layout/Layout";
// 首页是 initial route：窗口 show() 只等两个 rAF，拆成 chunk 会让内容区先空一帧，
// 所以这里保持静态导入；其余页面仍然按需加载。
import { HomeView } from "./views/HomeView";
import { PactModal } from "./components/PactModal";
import { LibraryDegradedNotice } from "./components/LibraryDegradedNotice";
import { CursorEffect } from "./components/CursorEffect";
import { DeepLinkHandler } from "./components/DeepLinkHandler";
import { UpdateModal } from "./components/UpdateModal";
import { CustomSourceUpdateModal } from "./components/CustomSourceUpdateModal";
import { CloseConfirmModal } from "./components/CloseConfirmModal";
import { checkForUpdate } from "./services/updateService";
import { useUpdateStore } from "./stores/updateStore";
import { attachPlaybackPersistence } from "./stores/playerPersistence";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useNativeControls } from "./hooks/useNativeControls";
import { setupSystemMediaControls } from "./services/smtcService";
import { setupTaskbarThumbnails } from "./services/taskbarService";
import { customSourcePersistence, useCustomSourceStore } from "./stores/customSourceStore";
import { favoritesPersistence } from "./stores/favoritesStore";
import { playlistPersistence } from "./stores/playlistStore";
import { historyPersistence } from "./stores/historyStore";
import { usePlayerStore, setPlaybackFailedAutoNext } from "./stores/playerStore";
import { playerEngine } from "./services/playerEngine";
import { logger } from "./services/logger";
import { normalizePauseOnExternalPlayback } from "./services/mediaInterruptionPolicy";
import { flushLibraryPersistence } from "./stores/libraryPersistence";
import { completeAppQuit, loadSettings } from "@lx/tauri-bridge";

/**
 * 路由页面按需加载：进入哪个页面才拉取那一份 chunk。
 * 首屏只加载外壳（侧栏 / 顶栏 / 播放条）与当前路由，搜索、歌单、设置这些大页面
 * 不再跟着启动一起解析。加载兜底在 Layout 的内容区里（见 components/Layout/Layout.tsx），
 * 所以切页只换内容，外壳与播放条不重建。
 */
const SearchView = lazy(() => import("./views/SearchView").then((module) => ({ default: module.SearchView })));
const SettingsView = lazy(() => import("./views/SettingsView").then((module) => ({ default: module.SettingsView })));
const LocalMusicView = lazy(() => import("./views/LocalMusicView").then((module) => ({ default: module.LocalMusicView })));
const PlaylistsView = lazy(() => import("./views/PlaylistsView").then((module) => ({ default: module.PlaylistsView })));
const DownloadsView = lazy(() => import("./views/DownloadsView").then((module) => ({ default: module.DownloadsView })));
const HistoryView = lazy(() => import("./views/HistoryView").then((module) => ({ default: module.HistoryView })));
const StatsView = lazy(() => import("./views/StatsView").then((module) => ({ default: module.StatsView })));
const PlaylistDetailView = lazy(() => import("./views/PlaylistDetailView").then((module) => ({ default: module.PlaylistDetailView })));
const CloudDriveView = lazy(() => import("./views/CloudDriveView").then((module) => ({ default: module.CloudDriveView })));
const DailyRecommendView = lazy(() => import("./views/DailyRecommendView").then((module) => ({ default: module.DailyRecommendView })));
const PersonalFmView = lazy(() => import("./views/PersonalFmView").then((module) => ({ default: module.PersonalFmView })));
const LeaderboardView = lazy(() => import("./views/LeaderboardView").then((module) => ({ default: module.LeaderboardView })));
const PlaylistSquareView = lazy(() => import("./views/PlaylistSquareView").then((module) => ({ default: module.PlaylistSquareView })));
const ArtistDetailView = lazy(() => import("./views/ArtistDetailView").then((module) => ({ default: module.ArtistDetailView })));
const AlbumDetailView = lazy(() => import("./views/AlbumDetailView").then((module) => ({ default: module.AlbumDetailView })));

const CUSTOM_SOURCE_UPDATE_CHECK_DELAY_MS = 4500;

export default function MainWindow() {
  useKeyboardShortcuts();
  useNativeControls();

  // 系统媒体控制（SMTC）：媒体键 / 系统媒体浮层 / 锁屏控制。只在主窗口挂载。
  useEffect(() => setupSystemMediaControls(), []);

  // 任务栏缩略图按钮与悬浮预览封面。只在主窗口挂载。
  useEffect(() => setupTaskbarThumbnails(), []);

  const [cursorEffect, setCursorEffect] = useState<"off" | "trail">("off");
  const setUpdateAvailable = useUpdateStore((s) => s.setAvailable);
  const featureEnabled = useCustomSourceStore((state) => state.featureEnabled);
  const featureReady = useCustomSourceStore((state) => state.featureReady);

  // 退出前把 debounce 中的写盘落盘。
  // 托盘退出走 Rust 的 app.exit(0)，进程会被直接结束；不 flush 就会丢掉退出前
  // ≤300ms（debounce 窗口）内的收藏/歌单/历史修改。
  useEffect(() => {
    const flush = () => {
      void flushLibraryPersistence().catch((error) => logger.warn('离开窗口时保存失败', error));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const registerUnlisten = (fn: () => void) => {
      if (disposed) fn();
      else unlisteners.push(fn);
    };
    void listen<{ requestId: string }>("app-before-quit", (event) => {
      void (async () => {
        let failure: string | null = null;
        try {
          await flushLibraryPersistence();
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
          logger.warn('退出前保存失败，已取消退出', error);
          showToast(`退出前保存失败：${failure}`, { kind: 'error' });
        }
        await completeAppQuit(event.payload.requestId, failure);
      })().catch((error) => logger.warn('退出完成应答失败', error));
    })
      .then(registerUnlisten)
      .catch((error) => logger.warn('无法监听退出保存请求', error));
    void listen<string>('app-quit-failed', ({ payload }) => {
      logger.warn('退出已取消', payload);
      showToast(payload, { kind: 'error' });
    }).then(registerUnlisten).catch((error) => logger.warn('无法监听退出失败通知', error));
    return () => {
      disposed = true;
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

  // 播放会话持久化：恢复队列 / 当前曲 / 上次播放位置（library 的 playback 命名空间）。
  // 只重建状态、不自动播放 —— 用户按下播放时由 playerStore 的 playThroughEngine
  // 取一次待恢复位置交给引擎（见 stores/playerPersistence.ts）。
  useEffect(() => {
    attachPlaybackPersistence();
  }, []);

  useEffect(() => {
    const loadCursor = () => {
      loadSettings()
        .then((s) => {
          setCursorEffect(s.cursorEffect === "trail" ? "trail" : "off");
          if (typeof s.volume === "number") {
            usePlayerStore.getState().setVolume(s.volume / 100);
          }
          playerEngine.setPauseOnExternalPlayback(normalizePauseOnExternalPlayback(s.pauseOnExternalPlayback));
          setPlaybackFailedAutoNext(s.playbackFailedAutoNext);
        })
        .catch(() => undefined);
    };
    loadCursor();
    window.addEventListener("af-cursor-change", loadCursor);
    // 启动后延迟检查更新，避免阻塞首屏。
    // 只有确实发现新版本才弹窗：静默检查失败不该打扰用户（网络抖动很常见），
    // 失败原因留给设置页的手动检查显示。
    const updateTimer = setTimeout(() => {
      checkForUpdate()
        .then((result) => {
          if (result.kind === "available") setUpdateAvailable(result);
        })
        .catch(() => undefined);
    }, 3000);
    let autoSyncTimer: number | undefined;
    let disposed = false;

    // 启动时自动同步歌单历史：
    // 必须等本地曲库（收藏/歌单/历史）hydrate 完成后才能开始，否则会把空数据当成本地全集
    // 上传回云端，造成云端数据被清空。延迟 4s 开始，避开首屏渲染与其它启动任务。
    Promise.all([
      loadSettings(),
      favoritesPersistence.ready,
      playlistPersistence.ready,
      historyPersistence.ready,
    ])
      .then(([s]) => {
        if (disposed || !s.webdavAutoSyncPlaylists) return;
        if (!(s.webdavUrl ?? "").trim() || !s.webdavPassword) return;
        autoSyncTimer = window.setTimeout(() => {
          void import("./services/webdavSyncService")
            .then(({ autoSyncPlaylistsOnce }) => autoSyncPlaylistsOnce())
            .catch((error) => {
              // 启动同步失败过去只写日志：用户只会看到「等了几秒，云端没变化」，
              // 无从判断是没配置、离线，还是合并被拒。这里补一条可见提示。
              logger.warn("[WebDAV 自动同步] 启动同步失败", error);
              const detail = error instanceof Error ? error.message : String(error);
              showToast(`WebDAV 自动同步失败：${detail}`, { kind: "error" });
            });
        }, 4000);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      window.removeEventListener("af-cursor-change", loadCursor);
      clearTimeout(updateTimer);
      if (autoSyncTimer != null) {
        window.clearTimeout(autoSyncTimer);
      }
    };
  }, []);

  // 音源检查随总开关独立启停，不重新执行应用更新或曲库自动同步。
  useEffect(() => {
    if (!featureEnabled || !featureReady) return;
    let disposed = false;
    let timer: number | undefined;
    Promise.all([loadSettings(), customSourcePersistence.ready])
      .then(([settings]) => {
        if (disposed || !settings.customSourceAutoCheck) return;
        timer = window.setTimeout(() => {
          const state = useCustomSourceStore.getState();
          if (disposed || !state.featureEnabled || !state.featureReady) return;
          void state.checkAllUpdates().catch((error) => {
            logger.warn("[LX 自动检查] 音源更新检查失败", error);
          });
        }, CUSTOM_SOURCE_UPDATE_CHECK_DELAY_MS);
      })
      .catch((error) => {
        logger.warn("[LX 自动检查] 读取设置失败", error);
      });
    return () => {
      disposed = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [featureEnabled, featureReady]);

  return (
    <>
      <BrowserRouter>
        <DeepLinkHandler />
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<HomeView />} />
            <Route path="search" element={<SearchView />} />
            <Route path="library" element={<Navigate to="/playlist/favorites" replace />} />
            <Route path="local" element={<LocalMusicView />} />
            <Route path="playlists" element={<PlaylistsView />} />
            <Route path="downloads" element={<DownloadsView />} />
            <Route path="history" element={<HistoryView />} />
            <Route path="stats" element={<StatsView />} />
            <Route path="playlist/:id" element={<PlaylistDetailView />} />
            <Route path="artist/:id" element={<ArtistDetailView />} />
            <Route path="album/:id" element={<AlbumDetailView />} />
            <Route path="daily" element={<DailyRecommendView />} />
            <Route path="cloud" element={<CloudDriveView />} />
            <Route path="charts" element={<LeaderboardView />} />
            <Route path="playlist-square" element={<PlaylistSquareView />} />
            <Route path="fm" element={<PersonalFmView />} />
            <Route path="settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <ToastHost />
      <PactModal />
      <LibraryDegradedNotice />
      <CursorEffect mode={cursorEffect} />
      <UpdateModal />
      <CustomSourceUpdateModal />
      <CloseConfirmModal />
    </>
  );
}
