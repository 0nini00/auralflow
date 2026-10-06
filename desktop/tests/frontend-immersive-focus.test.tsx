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
vi.mock('@/utils/desktopLyricToggle', () => ({ toggleDesktopLyricFromPlayer: async () => ({ open: true, locked: false }) }));
vi.mock('@/components/playerVisualizers/PlayerVisualizerRenderer', () => ({ PlayerVisualizerRenderer: () => <div>歌词</div> }));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => <button aria-label="添加到歌单">添加</button> }));
import { ImmersiveLyricsOverlay } from '../src/components/ImmersiveLyricsOverlay';
let root: Root; let trigger: HTMLButtonElement;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
beforeEach(async () => {
  vi.clearAllMocks(); actions.close.mockReset(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<button id="trigger">打开播放器</button><div id="root"></div><button id="background">后台操作</button>';
  trigger = document.getElementById('trigger') as HTMLButtonElement; trigger.focus();
  actions.player = { current: { id: '1', source: 'wy', name: 'Song', singer: 'Singer', albumName: 'Album' }, queue: [], currentIndex: -1, status: 'playing', progress: 25, duration: 120, volume: .5, isMuted: false, playbackRate: 1, repeatMode: 'all', isShuffle: false, togglePlay: vi.fn(), toggleMute: vi.fn(), setVolume: vi.fn(), setProgress: vi.fn(), setPlaybackRate: vi.fn(), setPlayMode: vi.fn(), playByIndex: vi.fn(), prev: vi.fn(), next: vi.fn(), removeFromQueue: vi.fn() };
  root = createRoot(document.getElementById('root')!);
  await act(async () => { root.render(<ImmersiveLyricsOverlay open onClose={actions.close} />); });
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
it('移除顶部按钮后聚焦播放进度，Tab不进入背景，关闭恢复触发点', async () => {
  expect(document.activeElement).toBe(document.querySelector('input[aria-label="播放进度"]'));
  await act(async () => button('更多').focus());
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(document.querySelector('input[aria-label="播放进度"]'));
  await act(async () => root.render(<ImmersiveLyricsOverlay open={false} onClose={actions.close} />));
  expect(document.activeElement).toBe(trigger);
});
it('Escape先关内部菜单，再关整个沉浸页，不双重触发', async () => {
  await act(async () => button('更多').click());
  await act(async () => button('复制歌曲链接').focus());
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('[aria-label="更多播放操作"]')).toBeNull();
  expect(actions.close).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button('更多'));
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(actions.close).toHaveBeenCalledTimes(1);
});


it('通过更多退出后恢复打开入口的焦点，重新打开不保留更多菜单', async () => {
  actions.close.mockImplementation(() => root.render(<ImmersiveLyricsOverlay open={false} onClose={actions.close} />));
  await act(async () => button('更多').click());
  const panel = document.querySelector('[aria-label="更多播放操作"]')!;
  const exit = panel.querySelector<HTMLButtonElement>('button[aria-label="退出沉浸式播放"]');
  expect(exit).not.toBeNull();
  await act(async () => { exit!.focus(); exit!.click(); });
  expect(actions.close).toHaveBeenCalledOnce();
  expect(document.querySelector('[aria-label="沉浸式歌词"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(document.body.style.overflow).toBe('');
  await act(async () => root.render(<ImmersiveLyricsOverlay open onClose={actions.close} />));
  expect(document.querySelector('[aria-label="更多播放操作"]')).toBeNull();
  expect(document.activeElement).toBe(document.querySelector('input[aria-label="播放进度"]'));
});
