// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MiniPlayerView } from '../src/views/MiniPlayerView';

const api = vi.hoisted(() => ({
  showMainWindow: vi.fn(),
  showMenu: vi.fn(),
  dispatch: vi.fn(),
  startDragging: vi.fn(),
  applyAppearance: vi.fn(),
  rehydrate: vi.fn(),
  state: {
    current: { id: 'song-1', name: '夜航', singer: '测试歌手' },
    status: 'playing',
    progress: 30,
    progressSampledAt: 0,
    duration: 120,
    playbackRate: 1,
  },
}));

vi.mock('@lx/tauri-bridge', () => ({
  showMainWindow: api.showMainWindow,
  showMiniPlayerMenu: api.showMenu,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: api.startDragging }),
}));
vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: (selector: (state: typeof api.state) => unknown) => selector(api.state),
}));
vi.mock('@/stores/playerSync', () => ({ dispatchLyricAction: api.dispatch }));
vi.mock('@/stores/themeStore', () => ({
  applyInitialAppearance: api.applyAppearance,
  useThemeStore: { persist: { rehydrate: api.rehydrate } },
}));
vi.mock('@/hooks/useInterpolatedPlaybackProgress', () => ({
  useInterpolatedPlaybackProgress: ({ progress }: { progress: number }) => progress,
}));
vi.mock('@/utils/imageReferrerPolicy', () => ({ coverSrc: (src: string) => src }));

let root: Root;
const button = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const bar = () => document.querySelector<HTMLElement>('.af-mini-player')!;

/** 迷你条自己实现拖拽/双击判定，用普通 MouseEvent 模拟指针事件即可。 */
function pointer(type: 'pointerdown' | 'pointerup' | 'pointermove', x: number, y: number) {
  act(() => {
    bar().dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, screenX: x, screenY: y }),
    );
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  api.showMainWindow.mockResolvedValue(undefined);
  api.showMenu.mockResolvedValue(undefined);
  api.startDragging.mockResolvedValue(undefined);
  api.rehydrate.mockResolvedValue(undefined);
  api.state.current = { id: 'song-1', name: '夜航', singer: '测试歌手' };
  api.state.status = 'playing';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  act(() => {
    root.render(<MiniPlayerView />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it('显示当前曲目信息与播放进度', () => {
  expect(document.querySelector('.af-mini-player-title')?.textContent).toBe('夜航');
  expect(document.querySelector('.af-mini-player-subtitle')?.textContent).toContain('测试歌手');
  // 30s / 120s = 25%
  const fill = document.querySelector<HTMLElement>('.af-mini-player-progress > span');
  expect(fill?.style.width).toBe('25%');
});

it('播放中显示暂停按钮，点击把动作转给主窗口执行', () => {
  act(() => button('暂停').click());
  expect(api.dispatch).toHaveBeenCalledWith('play-pause');

  act(() => button('上一首').click());
  act(() => button('下一首').click());
  expect(api.dispatch).toHaveBeenNthCalledWith(2, 'prev');
  expect(api.dispatch).toHaveBeenNthCalledWith(3, 'next');
});

it('没有当前曲目时按钮禁用', () => {
  act(() => root.unmount());
  api.state.current = null;
  api.state.status = 'paused';
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  act(() => {
    root.render(<MiniPlayerView />);
  });

  expect(button('播放').disabled).toBe(true);
  expect(button('上一首').disabled).toBe(true);
  expect(document.querySelector('.af-mini-player-title')?.textContent).toBe('未在播放');
});

it('右键弹原生菜单，不落到网页默认菜单', () => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  act(() => {
    bar().dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(api.showMenu).toHaveBeenCalledTimes(1);
});

it('双击回到主窗口', () => {
  pointer('pointerdown', 20, 20);
  pointer('pointerup', 20, 20);
  expect(api.showMainWindow).not.toHaveBeenCalled();

  pointer('pointerdown', 20, 20);
  pointer('pointerup', 20, 20);
  expect(api.showMainWindow).toHaveBeenCalledTimes(1);
});

it('拖动超过阈值走窗口拖动，且不算双击', () => {
  pointer('pointerdown', 20, 20);
  pointer('pointermove', 60, 20);
  expect(api.startDragging).toHaveBeenCalledTimes(1);

  pointer('pointerup', 60, 20);
  expect(api.showMainWindow).not.toHaveBeenCalled();
});

it('主窗口改主题时跟着换（af-theme 的 localStorage 变化）', async () => {
  await act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'af-theme', newValue: '{"state":{}}' }));
  });
  expect(api.rehydrate).toHaveBeenCalledTimes(1);
  expect(api.applyAppearance).toHaveBeenCalledTimes(1);

  // 其它键的变化不该触发重算外观
  await act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'af-something', newValue: '1' }));
  });
  expect(api.applyAppearance).toHaveBeenCalledTimes(1);
});
