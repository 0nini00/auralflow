import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ state: {} as any, time: 73, seek: vi.fn() }));
vi.mock('@/stores/playerStore', () => ({ usePlayerStore: () => deps.state }));
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
let renderer: ReactTestRenderer;
const range = () => renderer.root.findByProps({ 'aria-label': '进度' });
beforeEach(async () => {
  vi.clearAllMocks(); deps.time = 73;
  deps.state = { current: { id: '1', source: 'wy', name: 'Song', singer: 'Singer' }, status: 'playing', progress: 73, duration: 180, volume: .6, isMuted: false, playbackRate: 1, repeatMode: 'all', isShuffle: false, setProgress: deps.seek };
  await act(async () => { renderer = create(<PlayerBar />); });
});
afterEach(() => act(() => renderer?.unmount()));
it('按下后不移动立即松开，不显示或提交零值', () => {
  act(() => range().props.onPointerDown());
  expect(range().props.value).toBe(73);
  act(() => range().props.onPointerUp());
  expect(deps.seek).not.toHaveBeenCalled();
});
it.each(['onPointerCancel', 'onBlur'])('%s 取消拖动不提交草稿', event => {
  act(() => range().props.onPointerDown());
  act(() => range().props.onChange({ target: { value: '90' } }));
  act(() => range().props[event]());
  expect(deps.seek).not.toHaveBeenCalled();
  expect(range().props.value).toBe(73);
});
it('change与pointerup同一批次也只提交最新拖动值', () => {
  act(() => range().props.onPointerDown());
  act(() => { range().props.onChange({ target: { value: '91' } }); range().props.onPointerUp(); });
  expect(deps.seek).toHaveBeenCalledExactlyOnceWith(91);
});
it('拖动期间切换歌曲，旧草稿不能seek到新歌曲', () => {
  act(() => range().props.onPointerDown());
  act(() => range().props.onChange({ target: { value: '120' } }));
  deps.state = { ...deps.state, current: { ...deps.state.current, id: '2' }, progress: 3 }; deps.time = 3;
  act(() => renderer.update(<PlayerBar />));
  act(() => range().props.onPointerUp());
  expect(deps.seek).not.toHaveBeenCalled();
  expect(range().props.value).toBe(3);
});
it('键盘seek不进入拖动状态，后续进度可继续更新', () => {
  act(() => range().props.onChange({ target: { value: '74' } }));
  expect(deps.seek).toHaveBeenCalledExactlyOnceWith(74);
  deps.time = 75; act(() => renderer.update(<PlayerBar />));
  expect(range().props.value).toBe(75);
});
it('切歌后仍按住指针继续移动，不把旧手势变成新歌的键盘seek', () => {
  act(() => range().props.onPointerDown());
  act(() => range().props.onChange({ target: { value: '120' } }));
  deps.state = { ...deps.state, current: { ...deps.state.current, id: '2' }, progress: 3 }; deps.time = 3;
  act(() => renderer.update(<PlayerBar />));
  act(() => range().props.onChange({ target: { value: '130' } }));
  act(() => range().props.onPointerUp());
  expect(deps.seek).not.toHaveBeenCalled();
  expect(range().props.value).toBe(3);
  act(() => range().props.onChange({ target: { value: '4' } }));
  expect(deps.seek).toHaveBeenCalledExactlyOnceWith(4);
});
