// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/**
 * 窗口级拆分：四个窗口共用同一个 index.html，副窗口（迷你播放器 / 歌词窗 /
 * 桌面歌词解锁）不该连带解析主窗口的壳与页面。这里直接观察哪些模块被求值。
 */
const loaded = vi.hoisted(() => ({ modules: [] as string[], label: 'main' }));

vi.mock('@/utils/appWindow', () => ({ tryGetCurrentWindow: () => ({ label: loaded.label }) }));
vi.mock('@/stores/playerSync', () => ({ setupPlayerSync: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ debugLog: vi.fn(), loadSettings: async () => ({}), completeAppQuit: vi.fn() }));
vi.mock('@/components/Layout/Layout', () => { loaded.modules.push('Layout'); return { Layout: () => null }; });
vi.mock('@/components/PactModal', () => { loaded.modules.push('PactModal'); return { PactModal: () => null }; });
vi.mock('@/views/HomeView', () => { loaded.modules.push('HomeView'); return { HomeView: () => null }; });
vi.mock('@/views/SearchView', () => { loaded.modules.push('SearchView'); return { SearchView: () => null }; });
vi.mock('@/views/MiniPlayerView', () => { loaded.modules.push('MiniPlayerView'); return { MiniPlayerView: () => <div data-testid="mini-player" /> }; });
vi.mock('@/views/LyricWindowView', () => { loaded.modules.push('LyricWindowView'); return { LyricWindowView: () => <div data-testid="lyric-window" /> }; });
vi.mock('@/views/LyricUnlockView', () => { loaded.modules.push('LyricUnlockView'); return { LyricUnlockView: () => <div data-testid="lyric-unlock" /> }; });

let root: Root | undefined;

beforeEach(() => {
  vi.resetModules();
  loaded.modules = [];
  loaded.label = 'main';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

async function mount(label: string) {
  loaded.label = label;
  const { default: App } = await import('../src/App');
  await act(async () => {
    root = createRoot(document.getElementById('root')!);
    root.render(<App />);
  });
}

it('迷你播放器窗只加载自己那一份界面，不解析主窗口应用', async () => {
  await mount('mini-player');
  expect(document.querySelector('[data-testid="mini-player"]')).not.toBeNull();
  expect(loaded.modules).toEqual(['MiniPlayerView']);
});

it('歌词窗同样只加载歌词界面', async () => {
  await mount('lyric');
  expect(document.querySelector('[data-testid="lyric-window"]')).not.toBeNull();
  expect(loaded.modules).toEqual(['LyricWindowView']);
});

it('桌面歌词解锁窗同样只加载自己那一份界面', async () => {
  await mount('lyric-unlock');
  expect(document.querySelector('[data-testid="lyric-unlock"]')).not.toBeNull();
  expect(loaded.modules).toEqual(['LyricUnlockView']);
});
