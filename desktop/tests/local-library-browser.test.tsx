import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalLibraryBrowser } from '../src/components/LocalLibraryBrowser';
import type { LocalSong } from '../src/services/localMusicService';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ scanDirectory: vi.fn(), getAudioInfo: vi.fn() }));

const tracks: LocalSong[] = [
  { id: 'a', title: 'Alpha', artist: 'AC/DC', album: 'Live', path: 'C:\\Rock\\a.mp3', duration: 60, format: 'mp3', size: 10, isLocal: true, cover: 'embedded.jpg', coverOverride: 'manual.jpg' },
  { id: 'b', title: 'Beta', artist: 'AC/DC', album: 'Live', path: 'c:/ROCK/b.mp3', duration: 80, format: 'mp3', size: 10, isLocal: true },
  { id: 'c', title: 'Gamma', artist: 'Other', album: 'Live', path: 'D:\\Other\\c.mp3', duration: 90, format: 'mp3', size: 10, isLocal: true },
];
let renderer: ReactTestRenderer;
const onPlay = vi.fn();
const onEdit = vi.fn();
const onRemove = vi.fn();
const props = { localSongs: tracks, currentTrack: null, isPlaying: false, onPlay, onEdit, onRemove };
const root = () => renderer.root;
const button = (label: string) => root().findByProps({ 'aria-label': label });
const click = (label: string) => act(() => button(label).props.onClick());
const search = (value: string) => act(() => root().findByProps({ type: 'search' }).props.onChange({ target: { value } }));
const text = () => JSON.stringify(renderer.toJSON());
function mount() { act(() => { renderer = create(<LocalLibraryBrowser {...props} />); }); }
afterEach(() => { act(() => renderer?.unmount()); vi.clearAllMocks(); });

describe('本地曲库分类浏览', () => {
  it('分类、搜索和布局使用可聚焦原生控件，并展示数量', () => {
    mount();
    for (const label of ['全部', '艺术家', '专辑', '文件夹', '列表视图', '网格视图']) {
      expect(button(label).type).toBe('button');
    }
    expect(button('全部').props['aria-pressed']).toBe(true);
    expect(root().findByProps({ type: 'search' }).props['aria-label']).toBe('搜索本地音乐');
    expect(text()).toContain('3 首歌曲');
  });

  it('艺术家内搜索后播放队列仅包含当前结果，返回保留顶层搜索', () => {
    mount();
    click('艺术家');
    search('AC/DC');
    click('打开艺术家 AC/DC');
    expect(text()).toContain('2 首歌曲');
    search('Beta');
    click('播放 Beta');
    expect(onPlay).toHaveBeenCalledWith(tracks[1], [tracks[1]]);
    expect(button('播放 Beta').type).toBe('button');
    click('返回艺术家');
    expect(root().findByProps({ type: 'search' }).props.value).toBe('AC/DC');
    expect(button('打开艺术家 AC/DC')).toBeDefined();
  });

  it('专辑复合分类和文件夹分类均能打开正确的歌曲', () => {
    mount();
    click('专辑');
    click('打开专辑 Live · Other');
    click('播放 Gamma');
    expect(onPlay).toHaveBeenLastCalledWith(tracks[2], [tracks[2]]);
    click('文件夹');
    click('打开文件夹 c:/rock');
    click('播放 Beta');
    expect(onPlay).toHaveBeenLastCalledWith(tracks[1], [tracks[0], tracks[1]]);
  });

  it('列表和网格保留编辑、移除及当前播放状态，使用手选封面', () => {
    mount();
    click('编辑 Alpha');
    click('移除 Alpha');
    expect(onEdit).toHaveBeenCalledWith(tracks[0]);
    expect(onRemove).toHaveBeenCalledWith('a');
    expect(onPlay).not.toHaveBeenCalled();
    click('网格视图');
    expect(root().findAllByType('img').map((image) => image.props.src)).toContain('manual.jpg');
    click('编辑 Alpha');
    click('移除 Alpha');
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onRemove).toHaveBeenCalledTimes(2);
    act(() => renderer.update(<LocalLibraryBrowser {...props} currentTrack={{ id: 'a', source: 'local' }} isPlaying />));
    expect(button('暂停 Alpha').type).toBe('button');
  });

  it('全库搜索不受布局切换影响，空结果和空库明确区分', () => {
    mount();
    search('Gamma');
    click('网格视图');
    click('播放 Gamma');
    expect(onPlay).toHaveBeenLastCalledWith(tracks[2], [tracks[2]]);
    search('missing');
    expect(text()).toContain('没有匹配的歌曲');
    click('清除搜索');
    expect(text()).toContain('3 首歌曲');
    act(() => renderer.update(<LocalLibraryBrowser {...props} localSongs={[]} />));
    expect(text()).toContain('还没有本地音乐');
  });

  it('删除或编辑后重新派生分类，不展示失效分组旧歌曲或意外退回全库', () => {
    mount();
    click('艺术家');
    click('打开艺术家 AC/DC');
    act(() => renderer.update(<LocalLibraryBrowser {...props} localSongs={[tracks[2]]} />));
    expect(text()).toContain('此分类暂无歌曲');
    expect(root().findAllByProps({ 'aria-label': '播放 Gamma' })).toHaveLength(0);
    click('返回艺术家');
    expect(root().findAllByProps({ 'aria-label': '打开艺术家 AC/DC' })).toHaveLength(0);
    expect(button('打开艺术家 Other')).toBeDefined();
  });
});
