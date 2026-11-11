// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  return { player: {} as any, reportBackgroundError: undefined as undefined | ((message: string) => void) };
});
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: Object.assign((selector?: unknown) => (typeof selector === 'function' ? (selector as (state: typeof deps.player) => unknown)(deps.player) : deps.player), { getState: () => deps.player }) }));
vi.mock('@lx/tauri-bridge', () => ({ loadSettings: async () => ({}), patchSettings: async () => ({}), isLyricWindowOpen: async () => false, getLyricWindowState: async () => ({ locked: false }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@/stores/lyricSettingsSync', () => ({ subscribeLyricSettings: () => () => {}, broadcastLyricSettings: vi.fn() }));
vi.mock('@/hooks/useLyrics', () => ({ useLyrics: () => ({ lyrics: [], currentLine: 0 }) }));
vi.mock('@/hooks/useInterpolatedPlaybackProgress', () => ({ useInterpolatedPlaybackProgress: () => 25 }));
vi.mock('@/utils/desktopLyricToggle', () => ({ toggleDesktopLyricFromPlayer: async () => ({ open: true, locked: false }) }));
vi.mock('@/components/playerVisualizers/PlayerVisualizerRenderer', () => ({ PlayerVisualizerRenderer: () => <div>歌词内容</div> }));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => <button aria-label="添加到歌单">添加</button> }));
vi.mock('@/components/ImmersiveBackground', () => ({ ImmersiveBackground: ({ mode, playing, onError }: any) => {
  deps.reportBackgroundError = onError;
  return <canvas className="af-immersive-dynamic-background" data-mode={mode} data-playing={String(playing)} aria-hidden="true" />;
} }));
import { ImmersiveLyricsOverlay } from '../src/components/ImmersiveLyricsOverlay';
import { useThemeStore } from '../src/stores/themeStore';

let root: Root;
const close = vi.fn();
const canvas = () => document.querySelector('canvas');
const selector = () => document.querySelector<HTMLSelectElement>('select[aria-label="沉浸式播放背景"]')!;
async function choose(value: string) {
  expect(selector(), '更多菜单应提供背景切换').not.toBeNull();
  await act(async () => { selector().value = value; selector().dispatchEvent(new Event('change', { bubbles: true })); });
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  localStorage.clear();
  useThemeStore.getState().resetAppearance();
  deps.player = {
    current: { id: '1', source: 'wy', name: 'Song', singer: 'Singer', img: 'https://example.test/cover.jpg' },
    queue: [], currentIndex: 0, status: 'playing', progress: 25, duration: 120, volume: .5, isMuted: false,
    playbackRate: 1, repeatMode: 'all', isShuffle: false, togglePlay: vi.fn(), toggleMute: vi.fn(), setVolume: vi.fn(),
    setProgress: vi.fn(), setPlaybackRate: vi.fn(), setPlayMode: vi.fn(), playByIndex: vi.fn(), prev: vi.fn(), next: vi.fn(), removeFromQueue: vi.fn(),
  };
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(<ImmersiveLyricsOverlay open onClose={close} />));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });

it('默认保留封面背景，不初始化动态画布；更多菜单切换后立即显示并保存', async () => {
  expect(document.querySelector('.af-immersive-cover-glow')).not.toBeNull();
  expect(canvas()).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')!.click());
  await choose('liquid');
  expect(canvas()?.getAttribute('data-mode')).toBe('liquid');
  expect(canvas()?.getAttribute('aria-hidden')).toBe('true');
  expect(document.querySelector('.af-immersive-cover-glow')).toBeNull();
  expect(document.querySelector('.af-immersive-noise')).toBeNull();
  expect(JSON.parse(localStorage.getItem('af-theme')!).state.immersiveBackground).toBe('liquid');
  await choose('aurora');
  expect(canvas()?.getAttribute('data-mode')).toBe('aurora');
  await choose('cover');
  expect(canvas()).toBeNull();
  expect(document.querySelector('.af-immersive-cover-glow')).not.toBeNull();
});

it('外观状态变化实时同步，暂停向背景传递静止状态；关闭卸载、重开恢复选择', async () => {
  await act(async () => useThemeStore.getState().patchAppearance({ immersiveBackground: 'aurora' } as any));
  expect(canvas()?.getAttribute('data-mode')).toBe('aurora');
  expect(canvas()?.getAttribute('data-playing')).toBe('true');
  deps.player = { ...deps.player, status: 'paused' };
  await act(async () => root.render(<ImmersiveLyricsOverlay open onClose={close} />));
  expect(canvas()?.getAttribute('data-playing')).toBe('false');
  await act(async () => root.render(<ImmersiveLyricsOverlay open={false} onClose={close} />));
  expect(canvas()).toBeNull();
  await act(async () => root.render(<ImmersiveLyricsOverlay open onClose={close} />));
  expect(canvas()?.getAttribute('data-mode')).toBe('aurora');
});

it('图形错误可见且不篡改用户选择，恢复或主动切回封面后清除提示', async () => {
  await act(async () => useThemeStore.getState().patchAppearance({ immersiveBackground: 'liquid' } as any));
  expect(deps.reportBackgroundError).toBeTypeOf('function');
  await act(async () => deps.reportBackgroundError!('WebGL unavailable'));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('WebGL unavailable');
  expect(canvas()?.getAttribute('data-mode')).toBe('liquid');
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')!.click());
  await choose('aurora');
  expect(canvas()?.getAttribute('data-mode')).toBe('aurora');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('WebGL unavailable');
  await act(async () => deps.reportBackgroundError!(''));
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => deps.reportBackgroundError!('context lost'));
  await choose('cover');
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
