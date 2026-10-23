import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => {
  const startDragging = vi.fn(async () => undefined);
  const toggleMaximize = vi.fn(async () => undefined);
  return {
    startDragging,
    toggleMaximize,
    // useWindowDrag 在模块顶层就取窗口句柄（`const appWindow = tryGetCurrentWindow()`），
    // 所以这里必须立刻返回桩，否则 appWindow 为 null，后续窗口命令全是空操作。
    getCurrentWindow: vi.fn(() => ({ startDragging, toggleMaximize })),
    player: {
      current: { id: 't1', source: 'wy', name: '歌', singer: '人' },
      queue: [],
      currentIndex: 0,
      status: 'paused',
      progress: 10,
      progressSampledAt: 0,
      duration: 200,
      volume: 0.6,
      isMuted: false,
      playbackRate: 1,
      repeatMode: 'sequence',
      isShuffle: false,
      togglePlay: vi.fn(),
      toggleMute: vi.fn(),
      setVolume: vi.fn(),
      setProgress: vi.fn(),
      setPlaybackRate: vi.fn(),
      setPlayMode: vi.fn(),
      playByIndex: vi.fn(),
      prev: vi.fn(),
      next: vi.fn(),
      removeFromQueue: vi.fn(),
    },
    loadSettings: vi.fn(),
    patchSettings: vi.fn(),
    broadcast: vi.fn(),
    subscribe: vi.fn(),
    toggleDesktop: vi.fn(),
  };
});

vi.mock('@/stores/playerStore', () => ({ usePlayerStore: Object.assign(() => deps.player, { getState: () => deps.player }) }));
vi.mock('@lx/tauri-bridge', () => ({
  loadSettings: deps.loadSettings,
  patchSettings: deps.patchSettings,
  isLyricWindowOpen: async () => false,
  getLyricWindowState: async () => ({ locked: false }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@/stores/lyricSettingsSync', () => ({ broadcastLyricSettings: deps.broadcast, subscribeLyricSettings: deps.subscribe }));
vi.mock('@/hooks/useLyrics', () => ({ useLyrics: () => ({ lyrics: [], currentLine: 0 }) }));
vi.mock('@/hooks/useInterpolatedPlaybackProgress', () => ({ useInterpolatedPlaybackProgress: () => 25 }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: deps.getCurrentWindow }));
vi.mock('@/utils/desktopLyricToggle', () => ({ toggleDesktopLyricFromPlayer: deps.toggleDesktop }));
vi.mock('@/components/playerVisualizers/PlayerVisualizerRenderer', () => ({ PlayerVisualizerRenderer: () => null }));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => null }));
// 焦点循环由 frontend-immersive-focus.test.tsx 覆盖，这里保持空实现，免得初始焦点干扰拖拽断言。
vi.mock('@/hooks/useDialogFocus', () => ({ useDialogFocus: vi.fn() }));
import { ImmersiveLyricsOverlay } from '../src/components/ImmersiveLyricsOverlay';

let renderer: ReactTestRenderer;

beforeEach(() => {
  deps.startDragging.mockClear();
  deps.toggleMaximize.mockClear();
  deps.loadSettings.mockResolvedValue({ lyricShowTranslation: true });
  deps.patchSettings.mockResolvedValue({});
  deps.subscribe.mockReturnValue(() => {});
  deps.toggleDesktop.mockResolvedValue({ open: false, locked: false });
  // node 环境没有 DOM：组件会读 document.body.style.overflow 并挂 window 监听，这里给最小桩
  vi.stubGlobal('document', { body: { style: { overflow: '' } }, querySelector: () => null });
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: vi.fn(),
    requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
    cancelAnimationFrame: vi.fn(),
  });
  act(() => {
    renderer = create(<ImmersiveLyricsOverlay open onClose={() => {}} />);
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

const root = () => renderer.root.findByProps({ role: 'dialog' });

/**
 * 模拟事件目标：`hit` 命中时返回自身，其余选择器返回 null。
 * useWindowDrag 会先排除按钮等交互元素，这里一律不命中，只验证元素区域的白名单。
 */
function targetIn(selectorPattern: RegExp | null) {
  return {
    closest(selector: string) {
      return selectorPattern && selectorPattern.test(selector) ? {} : null;
    },
  };
}

describe('沉浸页窗口拖拽', () => {
  it('空白处按下即拖窗口，双击最大化', () => {
    act(() => root().props.onMouseDown({ button: 0, target: targetIn(null) }));
    expect(deps.startDragging).toHaveBeenCalledTimes(1);

    act(() => root().props.onDoubleClick({ target: targetIn(null) }));
    expect(deps.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it('歌词区、底部控件条、浮层面板里不接管，避免与拖拽滚动/控件点击冲突', () => {
    for (const pattern of [/\.af-immersive-lyric-section/, /\.af-immersive-controls/, /\.af-immersive-popover/]) {
      act(() => root().props.onMouseDown({ button: 0, target: targetIn(pattern) }));
      act(() => root().props.onDoubleClick({ target: targetIn(pattern) }));
    }

    expect(deps.startDragging).not.toHaveBeenCalled();
    expect(deps.toggleMaximize).not.toHaveBeenCalled();
  });
});
