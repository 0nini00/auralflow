import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Layout } from "./components/Layout/Layout";
import { HomeView } from "./views/HomeView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import { LocalMusicView } from "./views/LocalMusicView";
import { PlaylistsView } from "./views/PlaylistsView";
import { BiliCollectionsView } from "./views/BiliCollectionsView";
import { DownloadsView } from "./views/DownloadsView";
import { HistoryView } from "./views/HistoryView";
import { PlaylistDetailView } from "./views/PlaylistDetailView";
import { DailyRecommendView } from "./views/DailyRecommendView";
import { PersonalFmView } from "./views/PersonalFmView";
import { ArtistDetailView } from "./views/ArtistDetailView";
import { AlbumDetailView } from "./views/AlbumDetailView";
import { LyricWindowView } from "./views/LyricWindowView";
import { LyricUnlockView } from "./views/LyricUnlockView";
import { PactModal } from "./components/PactModal";
import { LibraryDegradedNotice } from "./components/LibraryDegradedNotice";
import { CursorEffect } from "./components/CursorEffect";
import { DeepLinkHandler } from "./components/DeepLinkHandler";
import { UpdateModal } from "./components/UpdateModal";
import { CustomSourceUpdateModal } from "./components/CustomSourceUpdateModal";
import { checkForUpdate } from "./services/updateService";
import { useUpdateStore } from "./stores/updateStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useNativeControls } from "./hooks/useNativeControls";
import { setupPlayerSync } from "./stores/playerSync";
import { detectWindowRoleFromParts, type AppWindowRole } from "./utils/windowRole";
import { customSourcePersistence, useCustomSourceStore } from "./stores/customSourceStore";
import { favoritesPersistence } from "./stores/favoritesStore";
import { playlistPersistence } from "./stores/playlistStore";
import { historyPersistence } from "./stores/historyStore";
import { usePlayerStore, setPlaybackFailedAutoNext } from "./stores/playerStore";
import { playerEngine } from "./services/playerEngine";
import { normalizePauseOnExternalPlayback } from "./services/mediaInterruptionPolicy";
import { flushLibraryPersistence } from "./stores/libraryPersistence";
import { loadSettings } from "@lx/tauri-bridge";

function MainApp() {
  useKeyboardShortcuts();
  useNativeControls();

  const [cursorEffect, setCursorEffect] = useState<"off" | "trail">("off");
  const setUpdateAvailable = useUpdateStore((s) => s.setAvailable);

  // 退出前把 debounce 中的写盘落盘。
  // 托盘退出走 Rust 的 app.exit(0)，进程会被直接结束；不 flush 就会丢掉退出前
  // ≤300ms（debounce 窗口）内的收藏/歌单/历史修改。
  useEffect(() => {
    const flush = () => {
      void flushLibraryPersistence();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listen("app-before-quit", flush)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unlisten?.();
    };
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
    let customSourceUpdateTimer: number | undefined;
    let autoSyncTimer: number | undefined;
    let disposed = false;
    Promise.all([loadSettings(), customSourcePersistence.ready])
      .then(([s]) => {
        if (disposed || !s.customSourceAutoCheck) return;
        customSourceUpdateTimer = window.setTimeout(() => {
          void useCustomSourceStore.getState().checkAllUpdates();
        }, 4500);
      })
      .catch(() => undefined);

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
              console.warn("[WebDAV 自动同步] 启动同步失败", error);
            });
        }, 4000);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      window.removeEventListener("af-cursor-change", loadCursor);
      clearTimeout(updateTimer);
      if (customSourceUpdateTimer != null) {
        window.clearTimeout(customSourceUpdateTimer);
      }
      if (autoSyncTimer != null) {
        window.clearTimeout(autoSyncTimer);
      }
    };
  }, []);

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
            <Route path="bili-collections" element={<BiliCollectionsView />} />
            <Route path="downloads" element={<DownloadsView />} />
            <Route path="history" element={<HistoryView />} />
            <Route path="playlist/:id" element={<PlaylistDetailView />} />
            <Route path="artist/:id" element={<ArtistDetailView />} />
            <Route path="album/:id" element={<AlbumDetailView />} />
            <Route path="daily" element={<DailyRecommendView />} />
            <Route path="fm" element={<PersonalFmView />} />
            <Route path="settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <PactModal onAccepted={() => {}} />
      <LibraryDegradedNotice />
      <CursorEffect mode={cursorEffect} />
      <UpdateModal />
      <CustomSourceUpdateModal />
    </>
  );
}

function App() {
  const [role, setRole] = useState<AppWindowRole | null>(null);

  useEffect(() => {
    const resolveRole = () => {
      const label = getCurrentWindow().label;
      const nextRole = detectWindowRoleFromParts(label, window.location.hash);
      if (nextRole !== "lyric-unlock") {
        setupPlayerSync(nextRole);
      }
      setRole(nextRole);
    };
    const onHashChange = () => resolveRole();
    resolveRole();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (!role) return null;
  if (role === "lyric") {
    return <LyricWindowView />;
  }
  if (role === "lyric-unlock") {
    return <LyricUnlockView />;
  }
  return <MainApp />;
}

export default App;
