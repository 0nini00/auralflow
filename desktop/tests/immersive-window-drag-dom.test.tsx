// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/**
 * 沉浸页是 `position: fixed; inset: 0` 的全窗表面，会把 z-index 只有 20 的顶栏整片盖住，
 * 而顶栏是唯一的窗口拖拽区 —— 所以「打开沉浸页就拖不动窗口」。
 * 修复是把拖拽接回页面根节点，并按区域白名单放行：歌词区自己要用拖拽滚动，控件条和浮层要点击。
 *
 * 这个文件用 jsdom 的真实元素 + 真实事件冒泡，验证守卫里的 `closest()` 在真实 DOM 上判断正确
 * （immersive-window-drag.test.tsx 用的是手写假目标，只验证调用链）。
 */

const deps = vi.hoisted(() => ({
  startDragging: vi.fn(async () => undefined),
  toggleMaximize: vi.fn(async () => undefined),
  player: {} as any,
}));

vi.mock('@/utils/appWindow', () => ({
  tryGetCurrentWindow: () => ({ startDragging: deps.startDragging, toggleMaximize: deps.toggleMaximize }),
}));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: Object.assign(() => deps.player, { getState: () => deps.player }) }));
vi.mock('@lx/tauri-bridge', () => ({
  loadSettings: async () => ({}),
  patchSettings: async () => ({}),
  isLyricWindowOpen: async () => false,
  getLyricWindowState: async () => ({ locked: false }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@/stores/lyricSettingsSync', () => ({ subscribeLyricSettings: () => () => {}, broadcastLyricSettings: vi.fn() }));
vi.mock('@/hooks/useLyrics', () => ({ useLyrics: () => ({ lyrics: [], currentLine: 0 }) }));
vi.mock('@/hooks/useInterpolatedPlaybackProgress', () => ({ useInterpolatedPlaybackProgress: () => 25 }));
vi.mock('@/utils/desktopLyricToggle', () => ({ toggleDesktopLyricFromPlayer: async () => ({ open: true, locked: false }) }));
vi.mock('@/components/playerVisualizers/PlayerVisualizerRenderer', () => ({
  PlayerVisualizerRenderer: () => <div data-testid="lyrics">歌词</div>,
}));
vi.mock('@/components/SongAddMenuButton', () => ({
  SongAddMenuButton: () => <button type="button" aria-label="添加到歌单">添加</button>,
}));
import { ImmersiveLyricsOverlay } from '../src/components/ImmersiveLyricsOverlay';

let root: Root;

beforeEach(async () => {
  deps.startDragging.mockClear();
  deps.toggleMaximize.mockClear();
  deps.player = {
    current: { id: '1', source: 'wy', name: 'Song', singer: 'Singer', albumName: 'Album' },
    queue: [], currentIndex: 0, status: 'playing', progress: 25, duration: 120, volume: .5, isMuted: false,
    playbackRate: 1, repeatMode: 'all', isShuffle: false,
    togglePlay: vi.fn(), toggleMute: vi.fn(), setVolume: vi.fn(), setProgress: vi.fn(), setPlaybackRate: vi.fn(),
    setPlayMode: vi.fn(), playByIndex: vi.fn(), prev: vi.fn(), next: vi.fn(), removeFromQueue: vi.fn(),
  };
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => { root.render(<ImmersiveLyricsOverlay open onClose={() => {}} />); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

const overlay = () => document.querySelector<HTMLElement>('[aria-label="沉浸式歌词"]')!;
const press = async (target: Element, type: 'mousedown' | 'dblclick' = 'mousedown') => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  });
};

it('真实 DOM：封面留白按下拖窗口、双击最大化', async () => {
  await press(document.querySelector<HTMLElement>('.af-immersive-cover-section')!);
  expect(deps.startDragging).toHaveBeenCalledTimes(1);

  await press(overlay(), 'dblclick');
  expect(deps.toggleMaximize).toHaveBeenCalledTimes(1);
});

it('真实 DOM：歌词区、控件条、右上角退出键、浮层面板里不接管', async () => {
  const lyricSection = document.querySelector<HTMLElement>('.af-immersive-lyric-section');
  const progress = document.querySelector<HTMLElement>('.af-immersive-controls input[aria-label="播放进度"]');
  const likeButton = document.querySelector<HTMLElement>('.af-immersive-controls button');
  // 右上角退出键在白名单选择器之外，靠 useWindowDrag 自己的 button 特判排除，这里一并验证
  const exitButton = document.querySelector<HTMLElement>('.af-immersive-exit');
  for (const target of [lyricSection, progress, likeButton, exitButton]) {
    expect(target, '守卫选择器必须命中真实节点，否则白名单失效').not.toBeNull();
    await press(target!);
    await press(target!, 'dblclick');
  }
  expect(deps.startDragging).not.toHaveBeenCalled();
  expect(deps.toggleMaximize).not.toHaveBeenCalled();

  // 浮层面板是 portal 到 body 的，不在 overlay 子树里，直接验证选择器能命中它
  await act(async () => { document.querySelector<HTMLElement>('button[aria-label="更多"]')!.click(); });
  const panel = document.querySelector<HTMLElement>('.af-immersive-popover');
  expect(panel).not.toBeNull();
  await press(panel!);
  expect(deps.startDragging).not.toHaveBeenCalled();
});
