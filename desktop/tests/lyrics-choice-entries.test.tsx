import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalLibraryBrowser } from '../src/components/LocalLibraryBrowser';
import {
  ImmersivePlayerControls,
  type ImmersivePlayerControlsProps,
} from '../src/components/ImmersivePlayerControls';
import type { LocalSong } from '../src/services/localMusicService';

/**
 * 「选择歌词」的两处入口：本地曲列表的行内按钮，与沉浸歌词页「更多」里的菜单行。
 *
 * 两处都只在调用方提供了入口时渲染——在线曲没有候选可挑，不该出现点了没用的控件。
 */

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ scanDirectory: vi.fn(), getAudioInfo: vi.fn() }));

const tracks: LocalSong[] = [
  {
    id: 'a', title: 'Alpha', artist: 'AC/DC', album: 'Live', path: 'C:\\Rock\\a.mp3',
    duration: 60, format: 'mp3', size: 10, isLocal: true,
    lyricsMode: 'local-only', lyricsFingerprint: '10:abc',
  },
  { id: 'b', title: 'Beta', artist: 'AC/DC', album: 'Live', path: 'C:\\Rock\\b.mp3', duration: 80, format: 'mp3', size: 10, isLocal: true },
];

describe('本地曲列表的行内入口', () => {
  let renderer: ReactTestRenderer;
  const onChooseLyrics = vi.fn();
  const props = {
    localSongs: tracks, currentTrack: null, isPlaying: false,
    onPlay: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(), onChooseLyrics,
  };
  const root = () => renderer.root;
  const mount = (extra: Record<string, unknown> = {}) => {
    act(() => { renderer = create(<LocalLibraryBrowser {...props} {...extra} />); });
  };
  afterEach(() => { act(() => renderer?.unmount()); vi.clearAllMocks(); });

  it('按钮带当前歌词状态，点击把整条记录交给上层', () => {
    mount();

    const button = root().findByProps({ 'aria-label': '选择歌词 Alpha' });
    expect(button.type).toBe('button');
    // 状态直接进 tooltip：列表里就能看出这首歌是「不匹配」还是选了某一份
    expect(button.props.title).toBe('选择歌词 · 当前：不匹配（只用本地歌词）');
    expect(root().findByProps({ 'aria-label': '选择歌词 Beta' }).props.title).toBe('选择歌词 · 当前：自动匹配');

    act(() => button.props.onClick());
    expect(onChooseLyrics).toHaveBeenCalledWith(tracks[0]);
  });

  it('调用方不提供入口时行内不渲染这个按钮', () => {
    mount({ onChooseLyrics: undefined });

    expect(root().findAllByProps({ 'aria-label': '选择歌词 Alpha' })).toHaveLength(0);
    expect(root().findByProps({ 'aria-label': '编辑 Alpha' })).toBeDefined();
  });
});

describe('沉浸歌词页「更多」里的入口', () => {
  let renderer: ReactTestRenderer;
  let props: ImmersivePlayerControlsProps;
  const open = vi.fn();
  const root = () => renderer.root;
  const button = (label: string) => root().findByProps({ 'aria-label': label });

  function render() {
    act(() => {
      renderer = create(<ImmersivePlayerControls {...props} />, { createNodeMock: () => null });
    });
  }

  beforeEach(() => {
    vi.stubGlobal('document', { querySelector: () => null });
    vi.stubGlobal('window', { requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn() });
    props = {
      playback: { isPlaying: true, volume: 0.5, isMuted: false, playbackRate: 1, mode: { id: 'sequence', label: '顺序播放' } },
      actions: {
        togglePlay: vi.fn(), toggleMute: vi.fn(), setVolume: vi.fn(), prev: vi.fn(), next: vi.fn(),
        cycleMode: vi.fn(), setPlaybackRate: vi.fn(), share: vi.fn(), exitImmersive: vi.fn(),
      },
      timeline: { current: 25, duration: 120, onSeek: vi.fn(), onSeekStart: vi.fn(), onSeekEnd: vi.fn() },
      lyrics: { showTranslation: true, showRomanization: true, showRuby: true, pending: false, onToggle: vi.fn() },
      queue: { tracks: [], currentIndex: 0, play: vi.fn(), remove: vi.fn() },
      desktopLyrics: { open: false, label: '打开桌面歌词', toggle: vi.fn() },
      onPanelOpenChange: vi.fn(),
      children: <button type="button" aria-label="收藏歌单插槽" />,
    };
  });
  afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('本地曲：菜单行随入口出现，点它先收面板再打开选择面板', () => {
    props.lyricsChoice = { label: '选择歌词', open };
    render();

    // 面板没开时入口不可见
    expect(root().findAllByProps({ 'aria-label': '选择歌词' })).toHaveLength(0);
    act(() => button('更多').props.onClick());

    const entry = button('选择歌词');
    expect(entry.type).toBe('button');
    act(() => entry.props.onClick());

    expect(open).toHaveBeenCalledOnce();
    // 菜单必须先收起：否则它会盖在即将出现的对话框上面
    expect(root().findAllByProps({ className: 'af-immersive-more-panel' })).toHaveLength(0);
  });

  it('在线曲 / 无入口时保持原有四条菜单行', () => {
    render();
    act(() => button('更多').props.onClick());

    expect(root().findByProps({ className: 'af-immersive-more-grid' }).children).toHaveLength(4);
    expect(root().findAllByProps({ 'aria-label': '选择歌词' })).toHaveLength(0);
  });
});
