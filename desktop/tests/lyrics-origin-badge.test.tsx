import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LyricOrigin } from '@lx/core';

/**
 * 歌词来源标注的可见性：同曲异唱档必须让用户看到「歌词来自 X 的演唱版本」，
 * 同一录音档与手动/本地覆盖都不显示。
 */

const deps = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  subscribe: vi.fn(),
  origin: null as LyricOrigin | null,
  player: {} as any,
}));

vi.mock('@lx/tauri-bridge', () => ({
  loadSettings: deps.loadSettings,
  patchSettings: vi.fn(),
  getLyricWindowState: async () => ({ locked: false }),
  prepareLyricWindowLock: vi.fn(),
  setLyricWindowPinned: vi.fn(),
  setLyricWindowLocked: vi.fn(),
  toggleLyricWindow: vi.fn(),
  isLyricWindowOpen: async () => false,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ show: async () => {}, hide: async () => {}, startDragging: vi.fn() }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@/stores/playerStore', () => ({
  usePlayerStore: Object.assign(
    (selector?: (state: any) => unknown) => (selector ? selector(deps.player) : deps.player),
    { getState: () => deps.player },
  ),
}));
vi.mock('@/stores/playerSync', () => ({ dispatchLyricAction: vi.fn() }));
vi.mock('@/stores/lyricSettingsSync', () => ({
  subscribeLyricSettings: deps.subscribe,
  broadcastLyricSettings: vi.fn(),
}));
vi.mock('@/hooks/useLyrics', () => ({
  useLyrics: () => ({ lyrics: [{ time: 1, text: '词' }], currentLine: 0, origin: deps.origin }),
}));
vi.mock('@/hooks/useInterpolatedPlaybackProgress', () => ({ useInterpolatedPlaybackProgress: () => 1.5 }));
vi.mock('@/components/ImmersivePlayerControls', async () => {
  const React = await import('react');
  // 真实组件被 ref 引用（overlay 要调用它的 dismissPanel），桩件必须能接受 ref
  return { ImmersivePlayerControls: React.forwardRef(function ImmersivePlayerControlsStub() { return <div />; }) };
});
vi.mock('@/hooks/useDialogFocus', () => ({ useDialogFocus: vi.fn() }));
vi.mock('@/utils/desktopLyricToggle', () => ({ toggleDesktopLyricFromPlayer: vi.fn() }));
vi.mock('@/components/playerVisualizers/PlayerVisualizerRenderer', () => ({ PlayerVisualizerRenderer: () => <div /> }));
vi.mock('@/components/SongAddMenuButton', () => ({ SongAddMenuButton: () => <div /> }));

import { LyricWindowView } from '../src/views/LyricWindowView';
import { ImmersiveLyricsOverlay } from '../src/components/ImmersiveLyricsOverlay';
import { LYRIC_ORIGIN_NOTE_HOLD_MS } from '../src/services/lyrics/lyricOriginNote';

let renderer: ReactTestRenderer;
const HINT = '歌词来自 湘伦 的演唱版本';

beforeEach(() => {
  vi.resetAllMocks();
  deps.loadSettings.mockResolvedValue({});
  deps.subscribe.mockReturnValue(() => {});
  deps.origin = null;
  deps.player = {
    current: { id: 'one', source: 'local', name: 'Bad Girl', singer: '吴亦凡/Kris' },
    queue: [], currentIndex: 0, status: 'playing', progress: 1, duration: 10,
    volume: 0.5, isMuted: false, playbackRate: 1, repeatMode: 'all', isShuffle: false,
  };
});

afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it('桌面歌词窗在同曲异唱档显示来源标注，同一录音档不显示', async () => {
  deps.origin = { tier: 'other-performer', performer: '湘伦', source: 'wy' };
  await act(async () => { renderer = create(<LyricWindowView />); });
  expect(renderer.root.findByProps({ className: 'af-lyric-origin-hint' }).children.join('')).toBe(HINT);

  await act(async () => { renderer.unmount(); });
  deps.origin = { tier: 'same-recording', source: 'wy' };
  await act(async () => { renderer = create(<LyricWindowView />); });
  expect(renderer.root.findAllByProps({ className: 'af-lyric-origin-hint' })).toHaveLength(0);
});

it('沉浸式歌词层在同曲异唱档显示来源标注，手动覆盖不显示', async () => {
  vi.stubGlobal('document', { body: { style: { overflow: '' } }, querySelector: () => null });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), setTimeout: vi.fn() });

  deps.origin = { tier: 'other-performer', performer: '湘伦', source: 'wy' };
  await act(async () => { renderer = create(<ImmersiveLyricsOverlay open onClose={() => {}} />); });
  expect(renderer.root.findByProps({ className: 'af-immersive-lyric-origin' }).children.join('')).toBe(HINT);

  await act(async () => { renderer.unmount(); });
  deps.origin = null;
  await act(async () => { renderer = create(<ImmersiveLyricsOverlay open onClose={() => {}} />); });
  expect(renderer.root.findAllByProps({ className: 'af-immersive-lyric-origin' })).toHaveLength(0);
});

it('来源标注只停留一次就退场：到点后不再显示（同曲异唱标的是知情提示，不是常驻徽标）', async () => {
  vi.useFakeTimers();
  try {
    deps.origin = { tier: 'other-performer', performer: '湘伦', source: 'wy' };
    await act(async () => { renderer = create(<LyricWindowView />); });
    expect(renderer.root.findAllByProps({ className: 'af-lyric-origin-hint' })).toHaveLength(1);

    await act(async () => { vi.advanceTimersByTime(LYRIC_ORIGIN_NOTE_HOLD_MS); });
    expect(renderer.root.findAllByProps({ className: 'af-lyric-origin-hint' })).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
