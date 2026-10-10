import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { customSourcePersistence, useCustomSourceStore } from "../src/stores/customSourceStore";

const dependencies = vi.hoisted(() => ({
  loadSettings: vi.fn(), checkForUpdate: vi.fn(), autoSyncPlaylistsOnce: vi.fn(),
  setVolume: vi.fn(), setPauseOnExternalPlayback: vi.fn(),
  setAvailable: vi.fn(), setupSystemMediaControls: vi.fn(), setupTaskbarThumbnails: vi.fn(),
}));
vi.mock("@/stores/customSourceStore", async () => {
  const { create } = await import("zustand");
  return {
    useCustomSourceStore: create(() => ({ featureEnabled: false, featureReady: true, checkAllUpdates: vi.fn() })),
    customSourcePersistence: { ready: Promise.resolve() },
  };
});
vi.mock("@lx/tauri-bridge", () => ({ loadSettings: dependencies.loadSettings }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("react-router-dom", () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => children,
  Routes: () => null, Route: () => null, Navigate: () => null,
}));
vi.mock("@/components/Layout/Layout", () => ({ Layout: () => null }));
vi.mock("@/components/PactModal", () => ({ PactModal: () => null }));
vi.mock("@/components/LibraryDegradedNotice", () => ({ LibraryDegradedNotice: () => null }));
vi.mock("@/components/CursorEffect", () => ({ CursorEffect: () => null }));
vi.mock("@/components/DeepLinkHandler", () => ({ DeepLinkHandler: () => null }));
vi.mock("@/components/UpdateModal", () => ({ UpdateModal: () => null }));
vi.mock("@/components/CustomSourceUpdateModal", () => ({ CustomSourceUpdateModal: () => null }));
vi.mock("@/views/HomeView", () => ({ HomeView: () => null }));
vi.mock("@/views/SearchView", () => ({ SearchView: () => null }));
vi.mock("@/views/SettingsView", () => ({ SettingsView: () => null }));
vi.mock("@/views/LocalMusicView", () => ({ LocalMusicView: () => null }));
vi.mock("@/views/PlaylistsView", () => ({ PlaylistsView: () => null }));
vi.mock("@/views/DownloadsView", () => ({ DownloadsView: () => null }));
vi.mock("@/views/HistoryView", () => ({ HistoryView: () => null }));
vi.mock("@/views/StatsView", () => ({ StatsView: () => null }));
vi.mock("@/views/PlaylistDetailView", () => ({ PlaylistDetailView: () => null }));
vi.mock("@/views/DailyRecommendView", () => ({ DailyRecommendView: () => null }));
vi.mock("@/views/PersonalFmView", () => ({ PersonalFmView: () => null }));
vi.mock("@/views/ArtistDetailView", () => ({ ArtistDetailView: () => null }));
vi.mock("@/views/AlbumDetailView", () => ({ AlbumDetailView: () => null }));
vi.mock("@/views/LyricWindowView", () => ({ LyricWindowView: () => null }));
vi.mock("@/views/LyricUnlockView", () => ({ LyricUnlockView: () => null }));
vi.mock("@/services/updateService", () => ({ checkForUpdate: dependencies.checkForUpdate }));
vi.mock("@/stores/updateStore", () => ({ useUpdateStore: (select: Function) => select({ setAvailable: dependencies.setAvailable }) }));
vi.mock("@/hooks/useKeyboardShortcuts", () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock("@/hooks/useNativeControls", () => ({ useNativeControls: vi.fn() }));
vi.mock("@/services/smtcService", () => ({ setupSystemMediaControls: dependencies.setupSystemMediaControls }));
vi.mock("@/services/taskbarService", () => ({ setupTaskbarThumbnails: dependencies.setupTaskbarThumbnails }));
vi.mock("@/stores/playerSync", () => ({ setupPlayerSync: vi.fn() }));
vi.mock("@/stores/favoritesStore", () => ({ favoritesPersistence: { ready: Promise.resolve() } }));
vi.mock("@/stores/playlistStore", () => ({ playlistPersistence: { ready: Promise.resolve() } }));
vi.mock("@/stores/historyStore", () => ({ historyPersistence: { ready: Promise.resolve() } }));
vi.mock("@/stores/playerStore", () => ({ usePlayerStore: { getState: () => ({ setVolume: dependencies.setVolume }) }, setPlaybackFailedAutoNext: vi.fn() }));
vi.mock("@/services/playerEngine", () => ({ playerEngine: { setPauseOnExternalPlayback: dependencies.setPauseOnExternalPlayback } }));
vi.mock("@/services/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/stores/libraryPersistence", () => ({ flushLibraryPersistence: vi.fn() }));
// App 现在会挂载播放会话持久化；这条测试只关心音源检查生命周期，把它挡掉。
vi.mock("@/stores/playerPersistence", () => ({ attachPlaybackPersistence: vi.fn() }));
vi.mock("@/services/webdavSyncService", () => ({ autoSyncPlaylistsOnce: dependencies.autoSyncPlaylistsOnce }));

let renderer: ReactTestRenderer | undefined;
const settings = { customSourceAutoCheck: true, webdavAutoSyncPlaylists: true, webdavUrl: "https://example.test", webdavPassword: "test" };
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    location: { hash: "" }, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
  }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  dependencies.loadSettings.mockResolvedValue(settings);
  dependencies.checkForUpdate.mockResolvedValue({ kind: "latest" });
  dependencies.autoSyncPlaylistsOnce.mockResolvedValue(undefined);
  customSourcePersistence.ready = Promise.resolve();
  useCustomSourceStore.setState({ featureEnabled: false, featureReady: true, checkAllUpdates: vi.fn(async () => {}) });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function mount() { await act(async () => { renderer = create(<App />); }); }
async function advance(time: number) { await act(async () => { await vi.advanceTimersByTimeAsync(time); }); }
async function feature(state: { featureEnabled?: boolean; featureReady?: boolean }) {
  await act(async () => { useCustomSourceStore.setState(state); });
}

describe("App 音源自动检查生命周期", () => {
  it("关闭时不检查 LX，但应用更新和启动同步照常运行", async () => {
    await mount();
    await advance(10000);
    expect(useCustomSourceStore.getState().checkAllUpdates).not.toHaveBeenCalled();
    expect(dependencies.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(dependencies.autoSyncPlaylistsOnce).toHaveBeenCalledTimes(1);
  });

  it("待恢复时不检查，恢复并开启后才等待 4500ms 检查", async () => {
    useCustomSourceStore.setState({ featureEnabled: true, featureReady: false });
    await mount();
    await advance(10000);
    expect(useCustomSourceStore.getState().checkAllUpdates).not.toHaveBeenCalled();
    await feature({ featureReady: true });
    await advance(4499);
    expect(useCustomSourceStore.getState().checkAllUpdates).not.toHaveBeenCalled();
    await advance(1);
    expect(useCustomSourceStore.getState().checkAllUpdates).toHaveBeenCalledTimes(1);
  });

  it("每次重新开启安排检查，不重跑无关的更新、同步或原生控制初始化", async () => {
    await mount();
    await advance(10000);
    await feature({ featureEnabled: true });
    await advance(4500);
    expect(useCustomSourceStore.getState().checkAllUpdates).toHaveBeenCalledTimes(1);
    await feature({ featureEnabled: false });
    await feature({ featureEnabled: true });
    await advance(4500);
    expect(useCustomSourceStore.getState().checkAllUpdates).toHaveBeenCalledTimes(2);
    expect(dependencies.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(dependencies.autoSyncPlaylistsOnce).toHaveBeenCalledTimes(1);
    expect(dependencies.setupSystemMediaControls).toHaveBeenCalledTimes(1);
    expect(dependencies.setupTaskbarThumbnails).toHaveBeenCalledTimes(1);
  });

  it("关闭会清除待执行计时器，旧回调也必须读取最新开关", async () => {
    useCustomSourceStore.setState({ featureEnabled: true });
    const schedule = vi.spyOn(window, "setTimeout");
    const clear = vi.spyOn(window, "clearTimeout");
    await mount();
    const timerIndex = schedule.mock.calls.findIndex(([, delay]) => delay === 4500);
    expect(timerIndex).toBeGreaterThanOrEqual(0);
    const callback = schedule.mock.calls[timerIndex][0] as () => void;
    const timerId = schedule.mock.results[timerIndex].value;
    act(() => {
      useCustomSourceStore.setState({ featureEnabled: false });
      callback();
    });
    expect(clear).toHaveBeenCalledWith(timerId);
    await advance(10000);
    expect(useCustomSourceStore.getState().checkAllUpdates).not.toHaveBeenCalled();
  });

  it("关闭后旧恢复任务完成也不会再安排音源检查", async () => {
    let finish!: () => void;
    customSourcePersistence.ready = new Promise<void>((resolve) => { finish = resolve; });
    useCustomSourceStore.setState({ featureEnabled: true });
    await mount();
    await feature({ featureEnabled: false });
    await act(async () => { finish(); });
    await advance(10000);
    expect(useCustomSourceStore.getState().checkAllUpdates).not.toHaveBeenCalled();
  });

  it("自动检测关闭时，开启 LX 也不安排更新检查", async () => {
    dependencies.loadSettings.mockResolvedValue({ ...settings, customSourceAutoCheck: false });
    useCustomSourceStore.setState({ featureEnabled: true });
    await mount();
    await advance(10000);
    expect(useCustomSourceStore.getState().checkAllUpdates).not.toHaveBeenCalled();
  });
});


it("旧配置启用 ReplayGain 不调用已删除接口，也不阻断普通播放设置恢复", async () => {
  dependencies.loadSettings.mockResolvedValue({ ...settings, replayGainEnabled: true, volume: 37, pauseOnExternalPlayback: false });
  await mount();
  expect(dependencies.setVolume).toHaveBeenCalledWith(0.37);
  expect(dependencies.setPauseOnExternalPlayback).toHaveBeenCalledWith(false);
});
