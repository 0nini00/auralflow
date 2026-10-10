// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// 与 frontend-player-bar.test.tsx 同一套替身：只有弹层需要真实 DOM（portal 到 body），
// 所以这里改用 jsdom + createRoot，其余依赖仍按最小替身桩掉。
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
vi.mock('@/stores/sleepTimerStore', () => ({ useSleepTimerStore: (select: any) => select({ mode: 'off', remainingSec: 0, remainingSongs: 0, startTimer: vi.fn(), startSongs: vi.fn(), cancel: vi.fn() }) }));
vi.mock('@/components/ImmersiveLyricsOverlay', () => ({ ImmersiveLyricsOverlay: () => null }));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => null }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@/stores/lyricSettingsSync', () => ({ subscribeLyricSettings: () => () => {} }));
vi.mock('@/utils/desktopLyricToggle', () => ({ toggleDesktopLyricFromPlayer: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ isLyricWindowOpen: async () => false, getLyricWindowState: async () => ({ locked: false }) }));

import { PlayerBar } from '../src/components/PlayerBar';

const track = (id: string, name: string) => ({ id, source: 'wy' as const, name, singer: `${name} 歌手` });
let root: Root;

const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="播放列表"]');
const panel = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="当前播放队列"]');
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click = (element: HTMLElement) => act(() => { element.click(); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  deps.state = {
    current: { id: '1', source: 'wy', name: '当前曲', singer: '歌手' },
    status: 'playing', progress: 73, progressSampledAt: 0, duration: 180, volume: 0.6, isMuted: false,
    playbackRate: 1, repeatMode: 'all', isShuffle: false, setProgress: deps.seek, togglePlay: vi.fn(),
    setPlayMode: vi.fn(), next: vi.fn(), prev: vi.fn(), toggleMute: vi.fn(), setVolume: vi.fn(),
    queue: [track('1', '第一首'), track('2', '第二首'), track('3', '第三首')], currentIndex: 0,
    playByIndex: deps.playByIndex, removeFromQueue: deps.removeFromQueue,
  };
  act(() => { root.render(<PlayerBar />); });
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

it('迷你栏暴露播放列表按钮，未点击时不渲染弹层', () => {
  expect(trigger()?.getAttribute('aria-label')).toBe('播放列表');
  expect(trigger()?.getAttribute('data-tooltip')).toBe('播放列表');
  expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
  expect(panel()).toBeNull();
});

it('点击按钮向上弹出队列面板，列出全部曲目并高亮当前曲', () => {
  click(trigger()!);
  const dialog = panel()!;
  expect(dialog.textContent).toContain('播放列表');
  expect(dialog.textContent).toContain('3 首');
  expect([...dialog.querySelectorAll('[aria-label^="播放 "]')].map((node) => node.getAttribute('aria-label')))
    .toEqual(['播放 第一首', '播放 第二首', '播放 第三首']);
  // 当前曲高亮 + aria-current，键盘与读屏都靠它定位「正在播的是哪首」
  const current = button('播放 第一首')!;
  expect(current.getAttribute('aria-current')).toBe('true');
  expect(current.closest('.af-bar-queue-item')!.classList.contains('af-playing')).toBe(true);
  expect(button('播放 第二首')!.getAttribute('aria-current')).toBeNull();

  // 迷你栏贴窗口底部，弹层只能朝上开：bottom 是触发按钮上沿到窗口底的距离，左缘夹在窗口内
  const layer = document.querySelector<HTMLElement>('.af-bar-queue-layer')!;
  expect(layer.style.bottom).toBe(`${window.innerHeight - trigger()!.getBoundingClientRect().top + 10}px`);
  expect(layer.style.left).toBe('8px');
  expect(trigger()!.getAttribute('aria-expanded')).toBe('true');
  expect(trigger()!.getAttribute('aria-controls')).toBe('af-bar-queue-panel');
});

it('点击曲目调用 playByIndex 并收起面板，焦点回到触发按钮', () => {
  act(() => { trigger()!.focus(); });
  click(trigger()!);
  click(button('播放 第二首')!);
  expect(deps.playByIndex).toHaveBeenCalledWith(1);
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it('移除按钮调用 removeFromQueue，且不连带播放、面板保持打开', () => {
  click(trigger()!);
  click(button('从播放列表移除 第二首')!);
  expect(deps.removeFromQueue).toHaveBeenCalledWith(1);
  expect(deps.playByIndex).not.toHaveBeenCalled();
  expect(panel()).not.toBeNull();
});

it('Escape 关闭面板并把焦点还给触发按钮', () => {
  act(() => { trigger()!.focus(); });
  click(trigger()!);
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it('点击背景遮罩关闭面板', () => {
  click(trigger()!);
  click(document.querySelector<HTMLElement>('.af-bar-queue-backdrop')!);
  expect(panel()).toBeNull();
});

it('队列为空时按钮仍可见，面板显示空态提示', () => {
  deps.state = { ...deps.state, queue: [], currentIndex: -1 };
  act(() => { root.render(<PlayerBar />); });
  expect(trigger()).not.toBeNull();
  click(trigger()!);
  const dialog = panel()!;
  expect(dialog.textContent).toContain('播放列表为空');
  expect(dialog.querySelectorAll('[aria-label^="播放 "]')).toHaveLength(0);
});
