// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const actions = vi.hoisted(() => ({ close: vi.fn(), player: {} as any }));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: Object.assign(() => actions.player, { getState: () => actions.player }) }));
vi.mock('@lx/tauri-bridge', () => ({ loadSettings: async () => ({}), patchSettings: async () => ({}), isLyricWindowOpen: async () => false, getLyricWindowState: async () => ({ locked: false }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@/stores/lyricSettingsSync', () => ({ subscribeLyricSettings: () => () => {}, broadcastLyricSettings: vi.fn() }));
vi.mock('@/hooks/useLyrics', () => ({ useLyrics: () => ({ lyrics: [], currentLine: 0 }) }));
vi.mock('@/hooks/useInterpolatedPlaybackProgress', () => ({ useInterpolatedPlaybackProgress: () => 25 }));
vi.mock('@/hooks/useNativeFullscreen', () => ({ useNativeFullscreen: () => ({ isFullscreen: false, toggleFullscreen: vi.fn() }) }));
vi.mock('@/utils/desktopLyricToggle', () => ({ toggleDesktopLyricFromPlayer: async () => ({ open: true, locked: false }) }));
vi.mock('@/components/playerVisualizers/PlayerVisualizerRenderer', () => ({ PlayerVisualizerRenderer: () => <div>歌词</div> }));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => <button aria-label="添加到歌单">添加</button> }));
import { ImmersiveLyricsOverlay } from '../src/components/ImmersiveLyricsOverlay';
let root: Root; let trigger: HTMLButtonElement;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
beforeEach(async () => {
  vi.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<button id="trigger">打开播放器</button><div id="root"></div><button id="background">后台操作</button>';
  trigger = document.getElementById('trigger') as HTMLButtonElement; trigger.focus();
  actions.player = { current: { id: '1', source: 'wy', name: 'Song', singer: 'Singer', albumName: 'Album' }, queue: [], currentIndex: -1, status: 'playing', progress: 25, duration: 120, volume: .5, isMuted: false, playbackRate: 1, repeatMode: 'all', isShuffle: false, togglePlay: vi.fn(), toggleMute: vi.fn(), setVolume: vi.fn(), setProgress: vi.fn(), setPlaybackRate: vi.fn(), setPlayMode: vi.fn(), playByIndex: vi.fn(), prev: vi.fn(), next: vi.fn(), removeFromQueue: vi.fn() };
  root = createRoot(document.getElementById('root')!);
  await act(async () => { root.render(<ImmersiveLyricsOverlay open onClose={actions.close} />); });
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
it('打开先聚焦关闭按钮，Tab不会进入背景，关闭恢复触发点', async () => {
  expect(document.activeElement).toBe(button('退出沉浸式播放'));
  await act(async () => button('更多').focus());
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(button('退出沉浸式播放'));
  await act(async () => root.render(<ImmersiveLyricsOverlay open={false} onClose={actions.close} />));
  expect(document.activeElement).toBe(trigger);
});
it('Escape先关内部菜单，再关整个沉浸页，不双重触发', async () => {
  await act(async () => button('更多').click());
  await act(async () => button('更多').focus());
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('[aria-label="更多播放操作"]')).toBeNull();
  expect(actions.close).not.toHaveBeenCalled();
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(actions.close).toHaveBeenCalledTimes(1);
});
