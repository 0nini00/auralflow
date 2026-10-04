import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalLibraryBrowser } from '../src/components/LocalLibraryBrowser';
import type { LocalSong } from '../src/services/localMusicService';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ scanDirectory: vi.fn(), getAudioInfo: vi.fn() }));

let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

describe('本地曲库键盘和虚拟列表', () => {
  it('方向键、End 和 Home 跨虚拟窗口移动焦点，回车/空格保留原生按钮行为', () => {
    const tracks: LocalSong[] = Array.from({ length: 50 }, (_, index) => ({
      id: String(index), title: `Track ${index}`, artist: 'Artist', album: 'Album',
      path: `C:/Music/${index}.mp3`, duration: 60, size: 1, format: 'mp3', isLocal: true,
    }));
    const focus = vi.fn();
    let onScroll = () => {};
    const scrollRoot = {
      scrollTop: 0, clientHeight: 120,
      getBoundingClientRect: () => ({ top: 0 }),
      addEventListener: (_type: string, callback: () => void) => { onScroll = callback; },
      removeEventListener: () => {},
      scrollTo: ({ top }: { top: number }) => { scrollRoot.scrollTop = top; onScroll(); },
    };
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const onPlay = vi.fn();
    act(() => {
      renderer = create(<LocalLibraryBrowser localSongs={tracks} currentTrack={null} isPlaying={false}
        onPlay={onPlay} onEdit={vi.fn()} onRemove={vi.fn()} />, {
        createNodeMock: (element) => {
          if (element.type === 'button') return { focus: () => focus(element.props['aria-label']) };
          if (element.props.className === 'af-local-content') return scrollRoot;
          if (element.props.className?.startsWith('af-virtual-list')) return {
            closest: () => scrollRoot, getBoundingClientRect: () => ({ top: -scrollRoot.scrollTop }),
          };
          return null;
        },
      });
    });
    const button = (index: number) => renderer.root.findByProps({ 'aria-label': `播放 Track ${index}` });
    const press = (index: number, key: string) => {
      const preventDefault = vi.fn();
      act(() => button(index).props.onKeyDown({ key, preventDefault }));
      return preventDefault;
    };
    expect(renderer.root.findAllByProps({ 'aria-label': '播放 Track 49' })).toHaveLength(0);
    expect(press(0, 'ArrowDown')).toHaveBeenCalled();
    expect(focus).toHaveBeenLastCalledWith('播放 Track 1');
    press(1, 'End');
    expect(button(49).type).toBe('button');
    expect(focus).toHaveBeenLastCalledWith('播放 Track 49');
    press(49, 'ArrowUp');
    expect(focus).toHaveBeenLastCalledWith('播放 Track 48');
    press(48, 'Home');
    expect(focus).toHaveBeenLastCalledWith('播放 Track 0');
    expect(press(0, 'Enter')).not.toHaveBeenCalled();
    expect(press(0, ' ')).not.toHaveBeenCalled();
    act(() => button(0).props.onClick());
    expect(onPlay).toHaveBeenCalledWith(tracks[0], tracks);
  });
});
