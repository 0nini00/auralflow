import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetadataEditModal } from '../src/components/MetadataEditModal';
import type { LocalSong } from '../src/services/localMusicService';

const native = vi.hoisted(() => ({
  getAudioInfo: vi.fn(), setAudioMetadata: vi.fn(), setAudioCover: vi.fn(), setAudioLyrics: vi.fn(),
  cacheRemoteImage: vi.fn(), saveManualCover: vi.fn(), open: vi.fn(), readFile: vi.fn(), stat: vi.fn(), updateSong: vi.fn(),
}));
vi.mock('@lx/tauri-bridge', () => native);
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: native.readFile, stat: native.stat }));
vi.mock('@/stores/libraryStore', () => ({ useLibraryStore: (selector: any) => selector({ updateSong: native.updateSong }) }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: vi.fn() }));
vi.mock('@/services/outboundHttp', () => ({ outboundRequest: vi.fn() }));

const song: LocalSong = {
  id: 'local-one', path: 'C:\\music\\one.mp3', title: '原歌名', artist: '歌手', album: '专辑',
  duration: 180, format: 'mp3', size: 100, isLocal: true, url: 'asset://original', cover: 'asset://original.jpg',
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let renderer: ReactTestRenderer | undefined;
let close: ReturnType<typeof vi.fn>;
const text = () => JSON.stringify(renderer!.toJSON());
const button = (label: string) => renderer!.root.findAllByType('button').find((node) => node.children.join('') === label)!;
const save = () => renderer!.root.findAllByType('button').find((node) => node.props.className === 'af-btn-primary')!;
async function mount(value: LocalSong | null = song) {
  await act(async () => { renderer = create(<MetadataEditModal song={value} onClose={close} />); });
}
beforeEach(() => {
  vi.resetAllMocks();
  close = vi.fn();
  native.saveManualCover.mockResolvedValue('C:\\data\\manual-covers\\picked.png');
  native.getAudioInfo.mockResolvedValue({ ...song, lyrics: '[00:01.00]原歌词' });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

describe('手动编辑保存边界', () => {
  it('默认只保存本机曲库，不写文件、不清除未编辑歌词或封面', async () => {
    await mount();
    await act(async () => { await save().props.onClick(); });
    expect(native.setAudioMetadata).not.toHaveBeenCalled();
    expect(native.setAudioLyrics).not.toHaveBeenCalled();
    expect(native.setAudioCover).not.toHaveBeenCalled();
    expect(native.updateSong).toHaveBeenCalledWith(song.id, {});
    expect(close).toHaveBeenCalledOnce();
  });

  it('读盘失败可见，保存其他字段不能把空歌词写回', async () => {
    native.getAudioInfo.mockRejectedValue(new Error('文件不可读'));
    await mount();
    expect(text()).toContain('文件不可读');
    await act(async () => { await save().props.onClick(); });
    expect(native.setAudioLyrics).not.toHaveBeenCalled();
    expect(native.updateSong.mock.calls[0][1]).not.toHaveProperty('lyricsOverride');
  });

  it('切歌后拒绝旧读盘响应', async () => {
    const first = deferred<any>();
    native.getAudioInfo.mockReturnValueOnce(first.promise);
    await mount();
    await act(async () => { renderer!.update(<MetadataEditModal song={{ ...song, id: 'two', path: 'D:\\two.mp3' }} onClose={close} />); });
    await act(async () => { first.resolve({ lyrics: '过期歌词' }); });
    expect(renderer!.root.findByType('textarea').props.value).toBe('[00:01.00]原歌词');
  });

  it('读盘迟到不覆盖用户手输歌词，已有手动覆盖优先', async () => {
    const pending = deferred<any>();
    native.getAudioInfo.mockReturnValueOnce(pending.promise);
    await mount({ ...song, lyricsOverride: '手动覆盖' });
    expect(renderer!.root.findByType('textarea').props.value).toBe('手动覆盖');
    act(() => renderer!.root.findByType('textarea').props.onChange({ target: { value: '新输入' } }));
    await act(async () => { pending.resolve({ lyrics: '磁盘歌词' }); });
    expect(renderer!.root.findByType('textarea').props.value).toBe('新输入');
    await act(async () => { await save().props.onClick(); });
    expect(native.updateSong).toHaveBeenCalledWith(song.id, { lyricsOverride: '新输入' });
  });

  it('只有显式checkbox才写文件，并只提交修改字段', async () => {
    await mount();
    const checkbox = renderer!.root.findByProps({ type: 'checkbox' });
    expect(checkbox.props.checked).toBe(false);
    expect(text()).toContain('不可撤回');
    act(() => {
      renderer!.root.findByType('textarea').props.onChange({ target: { value: '' } });
      checkbox.props.onChange({ target: { checked: true } });
    });
    await act(async () => { await save().props.onClick(); });
    expect(native.setAudioLyrics).toHaveBeenCalledWith(song.path, '');
    expect(native.setAudioMetadata).not.toHaveBeenCalled();
    expect(native.updateSong).toHaveBeenCalledWith(song.id, { lyricsOverride: '', embeddedLyrics: '', lyricsTranslationOverride: '', lyricsRomanizationOverride: '' });
  });

  it('文件写入部分失败如实报告、不关闭、不把失败内容伪装为已应用', async () => {
    await mount();
    native.setAudioLyrics.mockRejectedValue(new Error('只读文件'));
    act(() => {
      renderer!.root.findAllByType('input').find((node) => node.props.value === song.title)!.props.onChange({ target: { value: '新标题' } });
      renderer!.root.findByType('textarea').props.onChange({ target: { value: '新歌词' } });
      renderer!.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } });
    });
    await act(async () => { await save().props.onClick(); });
    expect(text()).toContain('只读文件');
    expect(text()).toContain('标题/歌手/专辑');
    expect(close).not.toHaveBeenCalled();
    expect(native.updateSong).toHaveBeenCalledWith(song.id, { title: '新标题' });
    expect(native.updateSong.mock.calls.every(([, patch]) => !('lyricsOverride' in patch))).toBe(true);
  });

  it('本地封面选择用短asset路径保存，不写文件也不持久化base64', async () => {
    native.open.mockResolvedValue('C:\\covers\\picked.png');
    native.stat.mockResolvedValue({ size: 8 });
    native.readFile.mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    await mount();
    await act(async () => { await button('更换封面').props.onClick(); });
    await act(async () => { await save().props.onClick(); });
    expect(native.updateSong).toHaveBeenCalledWith(song.id, { coverOverride: 'asset://C:\\data\\manual-covers\\picked.png' });
    expect(native.setAudioCover).not.toHaveBeenCalled();
    expect(JSON.stringify(native.updateSong.mock.calls)).not.toContain('base64');
  });
});
