import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualMediaMatchDialog } from '../src/components/ManualMediaMatchDialog';
import type { MusicInfo } from '@lx/core';
const api = vi.hoisted(() => ({ search: vi.fn(), getLyric: vi.fn(), getMusicDetail: vi.fn(), outbound: vi.fn(), cache: vi.fn() }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: () => api }));
vi.mock('@/services/outboundHttp', () => ({ outboundRequest: api.outbound }));
vi.mock('@lx/tauri-bridge', () => ({ cacheRemoteImage: api.cache, saveManualCover: api.cache, setAudioMetadata: vi.fn(), setAudioCover: vi.fn(), setAudioLyrics: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(), stat: vi.fn() }));
const first: MusicInfo = { id: '1', source: 'wy', name: '候选一', singer: '歌手一', albumName: '专辑一', interval: 123, picUrl: 'https://cover.test/1.png' };
const second: MusicInfo = { ...first, id: '2', name: '候选二', picUrl: 'https://cover.test/2.png' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let renderer: ReactTestRenderer | undefined;
let onLyrics: ReturnType<typeof vi.fn>, onCover: ReturnType<typeof vi.fn>, onClose: ReturnType<typeof vi.fn>;
const button = (name: string) => renderer!.root.findAllByType('button').find((node) => node.children.join('') === name)!;
const click = async (name: string) => { await act(async () => { await button(name).props.onClick(); }); };
const text = () => JSON.stringify(renderer!.toJSON());
async function mount() {
  await act(async () => { renderer = create(<ManualMediaMatchDialog initialQuery="歌曲" onLyrics={onLyrics} onCover={onCover} onClose={onClose} />); });
}
async function search() { await click('搜索'); }
async function select(name: string) { await act(async () => { renderer!.root.findByProps({ 'aria-label': `预览 ${name}` }).props.onClick(); }); }
beforeEach(() => {
  vi.resetAllMocks();
  onLyrics = vi.fn(); onCover = vi.fn(); onClose = vi.fn();
  api.search.mockResolvedValue({ songs: [first, second] });
  api.getLyric.mockImplementation(async (song) => ({ lyric: `[00:01.00]${song.name}歌词` }));
  api.getMusicDetail.mockImplementation(async (song) => song);
  api.outbound.mockResolvedValue({ ok: true, status: 200, base64: () => 'iVBORw0KGgo=' });
  api.cache.mockResolvedValue('C:\\cache\\cover.png');
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

describe('匹配窗口的显式选择与请求令牌', () => {
  it('不自动搜索/选第一首，候选展示四项信息，歌词和封面分别显式应用', async () => {
    await mount();
    expect(api.search).not.toHaveBeenCalled();
    await search();
    expect(api.getLyric).not.toHaveBeenCalled();
    expect(text()).toContain('歌手一'); expect(text()).toContain('专辑一'); expect(text()).toContain('2:03');
    await select('候选二');
    expect(onLyrics).not.toHaveBeenCalled(); expect(onCover).not.toHaveBeenCalled();
    await click('使用此歌词');
    expect(onLyrics).toHaveBeenCalledWith('[00:01.00]候选二歌词');
    expect(onCover).not.toHaveBeenCalled();
    await click('使用此封面');
    expect(onCover).toHaveBeenCalledWith({ path: 'C:\\cache\\cover.png', assetUrl: 'asset://C:\\cache\\cover.png' });
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
  it('切候选不接受旧歌词和封面预览，改平台清除选择', async () => {
    const lyric = deferred<any>(), cover = deferred<any>();
    api.getLyric.mockReturnValueOnce(lyric.promise); api.outbound.mockReturnValueOnce(cover.promise);
    await mount(); await search(); await select('候选一'); await select('候选二');
    await act(async () => { lyric.resolve({ lyric: '[00:01]过期歌词' }); cover.reject(new Error('过期封面错误')); });
    expect(text()).toContain('候选二歌词'); expect(text()).not.toContain('过期歌词'); expect(text()).not.toContain('过期封面错误');
    act(() => renderer!.root.findByProps({ 'aria-label': '匹配平台' }).props.onChange({ target: { value: 'tx' } }));
    expect(text()).not.toContain('候选二歌词');
  });
  it('关闭使已开始的封面缓存失效，不回调应用', async () => {
    const pending = deferred<string>(); api.cache.mockReturnValue(pending.promise);
    await mount(); await search(); await select('候选一');
    act(() => { void button('使用此封面').props.onClick(); });
    await click('返回编辑器');
    await act(async () => { pending.resolve('C:\\cache\\late.png'); });
    expect(onClose).toHaveBeenCalledOnce(); expect(onCover).not.toHaveBeenCalled();
  });
  it('缓存失败明确显示且不应用；歌词失败不妨碍独立选择封面', async () => {
    api.getLyric.mockRejectedValue(new Error('歌词服务故障'));
    api.cache.mockRejectedValue(new Error('缓存磁盘只读'));
    await mount(); await search(); await select('候选一');
    expect(text()).toContain('歌词服务故障');
    await click('使用此封面');
    expect(text()).toContain('缓存磁盘只读'); expect(onCover).not.toHaveBeenCalled();
  });
});
