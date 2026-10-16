import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualMediaMatchDialog } from '../src/components/ManualMediaMatchDialog';
import type { MusicInfo } from '@lx/core';
const api = vi.hoisted(() => ({ search: vi.fn(), getLyric: vi.fn() }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: () => api }));
vi.mock('@lx/tauri-bridge', () => ({ setAudioMetadata: vi.fn(), setAudioLyrics: vi.fn() }));
const first: MusicInfo = { id: '1', source: 'wy', name: '候选一', singer: '歌手一', albumName: '专辑一', interval: 123, picUrl: 'https://cover.test/1.png' };
const second: MusicInfo = { ...first, id: '2', name: '候选二', picUrl: 'https://cover.test/2.png' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let renderer: ReactTestRenderer | undefined;
let onLyrics: ReturnType<typeof vi.fn>, onClose: ReturnType<typeof vi.fn>;
const button = (name: string) => renderer!.root.findAllByType('button').find((node) => node.children.join('') === name)!;
const click = async (name: string) => { await act(async () => { await button(name).props.onClick(); }); };
const text = () => JSON.stringify(renderer!.toJSON());
async function mount() {
  await act(async () => { renderer = create(<ManualMediaMatchDialog initialQuery="歌曲" onLyrics={onLyrics} onClose={onClose} />); });
}
async function search() { await click('搜索'); }
async function select(name: string) { await act(async () => { renderer!.root.findByProps({ 'aria-label': `预览 ${name}` }).props.onClick(); }); }
beforeEach(() => {
  vi.resetAllMocks();
  onLyrics = vi.fn(); onClose = vi.fn();
  api.search.mockResolvedValue({ songs: [first, second] });
  api.getLyric.mockImplementation(async (song) => ({ lyric: `[00:01.00]${song.name}歌词` }));
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

describe('匹配窗口的显式选择与请求令牌', () => {
  it('不自动搜索/选第一首，候选展示四项信息，歌词需显式应用', async () => {
    await mount();
    expect(api.search).not.toHaveBeenCalled();
    await search();
    expect(api.getLyric).not.toHaveBeenCalled();
    expect(text()).toContain('歌手一'); expect(text()).toContain('专辑一'); expect(text()).toContain('2:03');
    await select('候选二');
    expect(onLyrics).not.toHaveBeenCalled();
    await click('使用此歌词');
    expect(onLyrics).toHaveBeenCalledWith('[00:01.00]候选二歌词');
  });
  it('改查询即作废旧搜索，旧失败也不能污染新查询', async () => {
    const pending = deferred<any>(); api.search.mockReturnValueOnce(pending.promise);
    await mount();
    act(() => { void button('搜索').props.onClick(); });
    act(() => renderer!.root.findByProps({ 'aria-label': '搜索关键词' }).props.onChange({ target: { value: '新查询' } }));
    await act(async () => { pending.reject(new Error('过期搜索失败')); });
    expect(text()).not.toContain('过期搜索失败'); expect(text()).not.toContain('候选一');
    await search(); expect(text()).toContain('候选一');
  });
  it('切候选不接受旧歌词预览，改平台清除选择', async () => {
    const lyric = deferred<any>();
    api.getLyric.mockReturnValueOnce(lyric.promise);
    await mount(); await search(); await select('候选一'); await select('候选二');
    await act(async () => { lyric.resolve({ lyric: '[00:01]过期歌词' }); });
    expect(text()).toContain('候选二歌词'); expect(text()).not.toContain('过期歌词');
    act(() => renderer!.root.findByProps({ 'aria-label': '匹配平台' }).props.onChange({ target: { value: 'tx' } }));
    expect(text()).not.toContain('候选二歌词');
  });
  it('关闭使已开始的歌词预览失效，迟到的响应不再应用', async () => {
    const pending = deferred<any>(); api.getLyric.mockReturnValueOnce(pending.promise);
    await mount(); await search(); await select('候选一');
    await click('返回编辑器');
    await act(async () => { pending.resolve({ lyric: '[00:01]迟到歌词' }); });
    expect(onClose).toHaveBeenCalledOnce(); expect(text()).not.toContain('迟到歌词');
  });
  it('歌词预览失败明确显示，换一个候选重新加载', async () => {
    api.getLyric.mockRejectedValueOnce(new Error('歌词服务故障'));
    await mount(); await search(); await select('候选一');
    expect(text()).toContain('歌词服务故障');
    await select('候选二');
    expect(text()).toContain('候选二歌词');
    expect(onLyrics).not.toHaveBeenCalled();
  });
});
