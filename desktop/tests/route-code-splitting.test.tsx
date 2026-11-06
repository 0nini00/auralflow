// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/**
 * 路由级拆分：主窗口的外壳（侧栏 / 顶栏 / 播放条）与页面分离，切页只换内容区。
 * 用真实 Layout 和真实路由，页面模块全部换成「被求值就记一笔」的桩。
 */
const loaded = vi.hoisted(() => ({ modules: [] as string[] }));

/** 视图桩：模块被求值时记录名字，同时给出可断言的渲染结果。 */
function viewModule(name: string) {
  loaded.modules.push(name);
  return { [name]: () => <div data-testid={`view-${name}`} /> };
}

vi.mock('@/utils/appWindow', () => ({ tryGetCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@lx/tauri-bridge', () => ({ debugLog: vi.fn(), loadSettings: vi.fn(async () => ({})), completeAppQuit: vi.fn() }));
vi.mock('@/components/Layout/Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('@/components/Layout/Topbar', () => ({ Topbar: () => <div data-testid="topbar" /> }));
vi.mock('@/components/PlayerBar', () => ({ PlayerBar: () => <div data-testid="player-bar" /> }));
vi.mock('@/components/NowPlayingPanel', () => ({ NowPlayingPanel: () => null }));
vi.mock('@/components/PactModal', () => ({ PactModal: () => null }));
vi.mock('@/components/LibraryDegradedNotice', () => ({ LibraryDegradedNotice: () => null }));
vi.mock('@/components/CursorEffect', () => ({ CursorEffect: () => null }));
vi.mock('@/components/DeepLinkHandler', () => ({ DeepLinkHandler: () => null }));
vi.mock('@/components/UpdateModal', () => ({ UpdateModal: () => null }));
vi.mock('@/components/CustomSourceUpdateModal', () => ({ CustomSourceUpdateModal: () => null }));
vi.mock('@/components/CloseConfirmModal', () => ({ CloseConfirmModal: () => null }));
vi.mock('@/components/ui/Toast', () => ({ showToast: vi.fn(), ToastHost: () => null }));
vi.mock('@/services/updateService', () => ({ checkForUpdate: vi.fn(async () => ({ kind: 'latest' })) }));
vi.mock('@/stores/updateStore', () => ({ useUpdateStore: (select: (state: { setAvailable: () => void }) => unknown) => select({ setAvailable: vi.fn() }) }));
vi.mock('@/hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/useNativeControls', () => ({ useNativeControls: vi.fn() }));
vi.mock('@/services/smtcService', () => ({ setupSystemMediaControls: vi.fn() }));
vi.mock('@/services/taskbarService', () => ({ setupTaskbarThumbnails: vi.fn() }));
vi.mock('@/stores/playerSync', () => ({ setupPlayerSync: vi.fn() }));
vi.mock('@/stores/playerPersistence', () => ({ attachPlaybackPersistence: vi.fn() }));
vi.mock('@/services/playerEngine', () => ({ playerEngine: { setPauseOnExternalPlayback: vi.fn() } }));
vi.mock('@/services/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/stores/libraryPersistence', () => ({ flushLibraryPersistence: vi.fn(async () => {}) }));
vi.mock('@/stores/favoritesStore', () => ({ favoritesPersistence: { ready: Promise.resolve() } }));
vi.mock('@/stores/playlistStore', () => ({ playlistPersistence: { ready: Promise.resolve() } }));
vi.mock('@/stores/historyStore', () => ({ historyPersistence: { ready: Promise.resolve() } }));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: Object.assign(() => ({}), { getState: () => ({ setVolume: vi.fn() }) }), setPlaybackFailedAutoNext: vi.fn() }));
vi.mock('@/services/webdavSyncService', () => ({ autoSyncPlaylistsOnce: vi.fn(async () => {}) }));
vi.mock('@/stores/customSourceStore', async () => {
  const { create } = await import('zustand');
  return {
    useCustomSourceStore: create(() => ({ featureEnabled: false, featureReady: true, checkAllUpdates: vi.fn() })),
    customSourcePersistence: { ready: Promise.resolve() },
  };
});
vi.mock("@/views/HomeView", () => viewModule("HomeView"));
vi.mock("@/views/SearchView", () => viewModule("SearchView"));
vi.mock("@/views/SettingsView", () => viewModule("SettingsView"));
vi.mock("@/views/LocalMusicView", () => viewModule("LocalMusicView"));
vi.mock("@/views/PlaylistsView", () => viewModule("PlaylistsView"));
vi.mock("@/views/DownloadsView", () => viewModule("DownloadsView"));
vi.mock("@/views/HistoryView", () => viewModule("HistoryView"));
vi.mock("@/views/StatsView", () => viewModule("StatsView"));
vi.mock("@/views/PlaylistDetailView", () => viewModule("PlaylistDetailView"));
vi.mock("@/views/CloudDriveView", () => viewModule("CloudDriveView"));
vi.mock("@/views/DailyRecommendView", () => viewModule("DailyRecommendView"));
vi.mock("@/views/PersonalFmView", () => viewModule("PersonalFmView"));
vi.mock("@/views/LeaderboardView", () => viewModule("LeaderboardView"));
vi.mock("@/views/PlaylistSquareView", () => viewModule("PlaylistSquareView"));
vi.mock("@/views/ArtistDetailView", () => viewModule("ArtistDetailView"));
vi.mock("@/views/AlbumDetailView", () => viewModule("AlbumDetailView"));
vi.mock("@/views/MiniPlayerView", () => viewModule("MiniPlayerView"));
vi.mock("@/views/LyricWindowView", () => viewModule("LyricWindowView"));
vi.mock("@/views/LyricUnlockView", () => viewModule("LyricUnlockView"));

let root: Root | undefined;

beforeEach(() => {
  vi.resetModules();
  loaded.modules = [];
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

async function mount() {
  const { default: App } = await import('../src/App');
  await act(async () => {
    root = createRoot(document.getElementById('root')!);
    root.render(<App />);
  });
}

async function navigate(path: string) {
  await act(async () => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

it('首屏只加载当前路由的页面，切页时才拉取目标页面', async () => {
  await mount();
  // 懒加载的页面要等模块到位后才出现在 DOM 里：模块求值在先，渲染随后。
  await vi.waitFor(() => {
    expect(document.querySelector('[data-testid="view-HomeView"]')).not.toBeNull();
  });
  expect(loaded.modules).toEqual(['HomeView']);
  await navigate('/stats');
  await vi.waitFor(() => {
    expect(document.querySelector('[data-testid="view-StatsView"]')).not.toBeNull();
  });
  expect(loaded.modules).toEqual(['HomeView', 'StatsView']);
});

it('切页只换内容区，外壳与播放条不重建', async () => {
  await mount();
  const sidebar = document.querySelector('[data-testid="sidebar"]');
  const playerBar = document.querySelector('[data-testid="player-bar"]');
  await navigate('/stats');
  expect(document.querySelector('[data-testid="sidebar"]')).toBe(sidebar);
  expect(document.querySelector('[data-testid="player-bar"]')).toBe(playerBar);
});

it('主窗口不加载副窗口的界面模块', async () => {
  await mount();
  expect(loaded.modules).not.toContain('MiniPlayerView');
  expect(loaded.modules).not.toContain('LyricWindowView');
  expect(loaded.modules).not.toContain('LyricUnlockView');
});
