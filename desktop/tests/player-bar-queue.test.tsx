// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/**
 * 播放队列从「迷你栏弹层」挪到了「正在播放」右栏：
 * 迷你栏只负责切换右栏开关（状态在 uiStore），队列本身由 NowPlayingPanel 渲染。
 * 这个文件同时覆盖两边的契约。
 */
const deps = vi.hoisted(() => ({
  state: {} as any,
  time: 73,
  seek: vi.fn(),
  playByIndex: vi.fn(async () => {}),
  removeFromQueue: vi.fn(),
}));

vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: (selector?: (state: any) => unknown) => (selector ? selector(deps.state) : deps.state),
}));
vi.mock('@/hooks/useInterpolatedPlaybackProgress', () => ({ useInterpolatedPlaybackProgress: () => deps.time }));
vi.mock('@/hooks/useArtworkAmbience', () => ({ useArtworkAmbience: vi.fn() }));
vi.mock('@/hooks/useLyrics', () => ({
  useLyrics: () => ({ lyrics: [], currentLine: -1, isLoading: false, error: null }),
}));
vi.mock('@/stores/sleepTimerStore', () => ({ useSleepTimerStore: (select: any) => select({ mode: 'off', remainingSec: 0, remainingSongs: 0, startTimer: vi.fn(), startSongs: vi.fn(), cancel: vi.fn() }) }));
vi.mock('@/components/ImmersiveLyricsOverlay', () => ({ ImmersiveLyricsOverlay: () => null }));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => null }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@/stores/lyricSettingsSync', () => ({ subscribeLyricSettings: () => () => {} }));
vi.mock('@/utils/desktopLyricToggle', () => ({ toggleDesktopLyricFromPlayer: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ isLyricWindowOpen: async () => false, getLyricWindowState: async () => ({ locked: false }) }));

import { PlayerBar } from '../src/components/PlayerBar';
import { NowPlayingPanel } from '../src/components/NowPlayingPanel';
import { useUiStore } from '../src/stores/uiStore';

const track = (id: string, name: string) => ({ id, source: 'wy' as const, name, singer: `${name} 歌手`, interval: 180 });
let root: Root;

const queueButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="播放队列"]');
const click = (element: HTMLElement) => act(() => { element.click(); });

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ nowPlayingOpen: false });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  deps.state = {
    current: { id: '1', source: 'wy', name: '当前曲', singer: '歌手', interval: 180 },
    status: 'playing', progress: 73, progressSampledAt: 0, duration: 180, volume: 0.6, isMuted: false,
    playbackRate: 1, repeatMode: 'all', isShuffle: false, setProgress: deps.seek, togglePlay: vi.fn(),
    setPlayMode: vi.fn(), next: vi.fn(), prev: vi.fn(), toggleMute: vi.fn(), setVolume: vi.fn(),
    queue: [track('1', '第一首'), track('2', '第二首'), track('3', '第三首')], currentIndex: 0,
    playByIndex: deps.playByIndex, removeFromQueue: deps.removeFromQueue,
  };
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

it('迷你栏的队列按钮切换右栏开关，aria-pressed 跟随状态', () => {
  act(() => { root.render(<PlayerBar />); });
  const trigger = queueButton()!;
  expect(trigger.getAttribute('aria-pressed')).toBe('false');

  click(trigger);
  expect(useUiStore.getState().nowPlayingOpen).toBe(true);
  expect(queueButton()!.getAttribute('aria-pressed')).toBe('true');

  click(queueButton()!);
  expect(useUiStore.getState().nowPlayingOpen).toBe(false);
});

it('右栏列出全部曲目、高亮当前曲，点击曲目播放', () => {
  act(() => { root.render(<NowPlayingPanel />); });
  const rows = [...document.querySelectorAll<HTMLElement>('.af-np-row')];
  expect(rows).toHaveLength(3);
  expect(rows[0].classList.contains('af-active')).toBe(true);
  expect(rows[1].classList.contains('af-active')).toBe(false);
  expect(document.querySelector('.af-np-queue-label')?.textContent).toContain('接下来 2 首');

  click(rows[1].querySelector<HTMLElement>('.af-np-row-main')!);
  expect(deps.playByIndex).toHaveBeenCalledWith(1);
});

it('移除按钮调用 removeFromQueue，不连带播放', () => {
  act(() => { root.render(<NowPlayingPanel />); });
  const remove = document.querySelector<HTMLButtonElement>('button[aria-label="从队列移除 第二首"]')!;
  click(remove);
  expect(deps.removeFromQueue).toHaveBeenCalledWith(1);
  expect(deps.playByIndex).not.toHaveBeenCalled();
});

it('空队列时给出提示，而不是空白面板', () => {
  deps.state.queue = [];
  deps.state.currentIndex = -1;
  act(() => { root.render(<NowPlayingPanel />); });
  expect(document.querySelectorAll('.af-np-row')).toHaveLength(0);
  expect(document.body.textContent).toContain('队列是空的');
});

it('收起按钮把右栏关掉', () => {
  useUiStore.setState({ nowPlayingOpen: true });
  act(() => { root.render(<NowPlayingPanel />); });
  click(document.querySelector<HTMLButtonElement>('button[aria-label="收起正在播放面板"]')!);
  expect(useUiStore.getState().nowPlayingOpen).toBe(false);
});
