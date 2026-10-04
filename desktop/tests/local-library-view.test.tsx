import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMusicView } from '../src/views/LocalMusicView';
import { useLibraryStore } from '../src/stores/libraryStore';
import { usePlayerStore } from '../src/stores/playerStore';
import { LocalMusicService, localSongToMusicInfo, type LocalSong } from '../src/services/localMusicService';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ scanDirectory: vi.fn(), getAudioInfo: vi.fn() }));
vi.mock('@/components/MetadataEditModal', () => ({ MetadataEditModal: () => null }));
vi.mock('@/stores/libraryStore', async () => {
  const { create } = await import('zustand');
  return { useLibraryStore: create(() => ({ localSongs: [], scanPaths: [], isScanning: false,
    addSongs: vi.fn(), removeSong: vi.fn(), setScanning: vi.fn(), addScanPath: vi.fn(), refreshLibrary: vi.fn(),
  })) };
});
vi.mock('@/stores/playerStore', async () => {
  const { create } = await import('zustand');
  return { usePlayerStore: create(() => ({ current: null, queue: [], status: 'paused',
    playQueue: vi.fn(async () => {}), togglePlay: vi.fn(),
  })) };
});
const tracks: LocalSong[] = ['Alpha', 'Beta', 'Gamma'].map((title, index) => ({
  id: String(index), title, artist: index === 2 ? 'Other' : 'AC/DC', album: 'Live',
  path: `C:\\Music\\${title}.mp3`, duration: 120, size: 100, format: 'mp3', isLocal: true,
  lyricsOverride: '[00:01]歌词', coverOverride: 'manual.jpg', replayGain: { gainDb: -3 },
}));
let renderer: ReactTestRenderer;
const root = () => renderer.root;
const click = (label: string) => act(() => root().findByProps({ 'aria-label': label }).props.onClick());
const search = (value: string) => act(() => root().findByProps({ type: 'search' }).props.onChange({ target: { value } }));
function mount() { act(() => { renderer = create(<LocalMusicView />); }); }
beforeEach(() => {
  useLibraryStore.setState({ localSongs: tracks, scanPaths: ['C:\\Music'], isScanning: false });
  usePlayerStore.setState({ current: null, queue: [], status: 'paused' });
});
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('本地音乐页面集成', () => {
  it('筛选队列使用公共转换函数、正确起始索引且保留覆盖数据', async () => {
    mount();
    click('艺术家');
    click('打开艺术家 AC/DC');
    await click('播放 Beta');
    expect(usePlayerStore.getState().playQueue).toHaveBeenCalledWith(tracks.slice(0, 2).map(localSongToMusicInfo), 1);
  });

  it('当前歌曲只有在队列匹配时切换暂停，筛选变化后替换全库旧队列', async () => {
    mount();
    act(() => usePlayerStore.setState({ current: localSongToMusicInfo(tracks[1]), queue: tracks.map(localSongToMusicInfo), status: 'playing' }));
    await click('暂停 Beta');
    expect(usePlayerStore.getState().togglePlay).toHaveBeenCalledTimes(1);
    search('Beta');
    await click('暂停 Beta');
    expect(usePlayerStore.getState().playQueue).toHaveBeenLastCalledWith([localSongToMusicInfo(tracks[1])], 0);
    expect(usePlayerStore.getState().togglePlay).toHaveBeenCalledTimes(1);
  });

  it('扫描失败明确呈现并结束扫描，不吞掉播放错误', async () => {
    vi.spyOn(LocalMusicService, 'selectDirectory').mockResolvedValue('C:\\Music');
    vi.spyOn(LocalMusicService, 'scanDirectory').mockRejectedValue(new Error('folder denied'));
    mount();
    await click('扫描文件夹');
    expect(root().findByProps({ role: 'alert' }).children.join('')).toContain('folder denied');
    expect(useLibraryStore.getState().setScanning).toHaveBeenLastCalledWith(false);
    vi.mocked(usePlayerStore.getState().playQueue).mockRejectedValueOnce(new Error('play failed'));
    await click('播放 Alpha');
    expect(root().findByProps({ role: 'alert' }).children.join('')).toContain('play failed');
  });

  it('扫描、添加、刷新和确认移除仍连接原有接口', async () => {
    vi.spyOn(LocalMusicService, 'selectDirectory').mockResolvedValue('D:\\Music');
    vi.spyOn(LocalMusicService, 'scanDirectory').mockResolvedValue([tracks[0]]);
    vi.spyOn(LocalMusicService, 'selectFiles').mockResolvedValue([tracks[1].path]);
    vi.spyOn(LocalMusicService, 'getAudioInfo').mockResolvedValue(tracks[1]);
    vi.mocked(useLibraryStore.getState().refreshLibrary).mockResolvedValue({ failedPaths: [] });
    vi.stubGlobal('confirm', vi.fn(() => true));
    mount();
    await click('扫描文件夹');
    expect(useLibraryStore.getState().addSongs).toHaveBeenCalledWith([tracks[0]]);
    expect(useLibraryStore.getState().addScanPath).toHaveBeenCalledWith('D:\\Music');
    await click('添加文件');
    expect(useLibraryStore.getState().addSongs).toHaveBeenLastCalledWith([tracks[1]]);
    await click('刷新');
    expect(useLibraryStore.getState().refreshLibrary).toHaveBeenCalledOnce();
    click('移除 Alpha');
    expect(useLibraryStore.getState().removeSong).toHaveBeenCalledWith('0');
  });
});
