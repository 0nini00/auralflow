import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Layout } from "./components/Layout/Layout";
import { HomeView } from "./views/HomeView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import { FavoritesView } from "./views/FavoritesView";
import { LocalMusicView } from "./views/LocalMusicView";
import { PlaylistsView } from "./views/PlaylistsView";
import { DownloadsView } from "./views/DownloadsView";
import { PlaylistDetailView } from "./views/PlaylistDetailView";
import { PlayerView } from "./views/PlayerView";
import { DailyRecommendView } from "./views/DailyRecommendView";
import { PersonalFmView } from "./views/PersonalFmView";
import { ArtistDetailView } from "./views/ArtistDetailView";
import { AlbumDetailView } from "./views/AlbumDetailView";
import { LyricWindowView } from "./views/LyricWindowView";
import { LyricUnlockView } from "./views/LyricUnlockView";
import { PactModal } from "./components/PactModal";
import { CursorEffect } from "./components/CursorEffect";
import { DeepLinkHandler } from "./components/DeepLinkHandler";
import { UpdateModal } from "./components/UpdateModal";
import type { UpdateInfo } from "./services/updateService";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useNativeControls } from "./hooks/useNativeControls";
import { setupPlayerSync } from "./stores/playerSync";
import { detectWindowRoleFromParts, type AppWindowRole } from "./utils/windowRole";
import { setupScrobble } from "./services/scrobbleService";
import { useCustomSourceStore } from "./stores/customSourceStore";
import { usePlayerStore } from "./stores/playerStore";
import { loadSettings } from "@lx/tauri-bridge";

let scrobbleStarted = false;

function ensureScrobble() {
  if (scrobbleStarted) return;
  scrobbleStarted = true;
  setupScrobble();
}

function MainApp() {
  useKeyboardShortcuts();
  useNativeControls();

  const [cursorEffect, setCursorEffect] = useState<"off" | "trail">("off");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    ensureScrobble();

    const loadCursor = () => {
      loadSettings()
        .then((s) => {
          setCursorEffect(s.cursorEffect === "trail" ? "trail" : "off");
          if (typeof s.volume === "number") {
            usePlayerStore.getState().setVolume(s.volume / 100);
          }
        })
        .catch(() => {});
    };
    loadCursor();
    window.addEventListener("af-cursor-change", loadCursor);
    // 启动后延迟检查更新，避免阻塞首屏
    const updateTimer = setTimeout(() => {
      import("./services/updateService")
        .then(({ checkForUpdates }) => checkForUpdates())
        .then(setUpdateInfo)
        .catch(() => {});
    }, 3000);
    let customSourceUpdateTimer: number | undefined;
    let disposed = false;
    loadSettings()
      .then((s) => {
        if (disposed || !s.customSourceAutoCheck) return;
        customSourceUpdateTimer = window.setTimeout(() => {
          void useCustomSourceStore.getState().checkAllUpdates();
        }, 4500);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      window.removeEventListener("af-cursor-change", loadCursor);
      clearTimeout(updateTimer);
      if (customSourceUpdateTimer != null) {
        window.clearTimeout(customSourceUpdateTimer);
      }
    };
  }, []);

  return (
    <>
      <BrowserRouter>
        <DeepLinkHandler />
        <Routes>
          <Route path="/player" element={<PlayerView />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<HomeView />} />
            <Route path="search" element={<SearchView />} />
            <Route path="library" element={<FavoritesView />} />
            <Route path="local" element={<LocalMusicView />} />
            <Route path="playlists" element={<PlaylistsView />} />
            <Route path="downloads" element={<DownloadsView />} />
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
      <CursorEffect mode={cursorEffect} />
      {updateInfo && (
        <UpdateModal info={updateInfo} onClose={() => setUpdateInfo(null)} />
      )}
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
