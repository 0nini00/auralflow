import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheManualCover, getManualCover, getManualLyrics, searchManualMedia } from '../src/services/manualMediaMatchService';
import type { MusicInfo } from '@lx/core';
const api = vi.hoisted(() => ({ search: vi.fn(), getLyric: vi.fn(), getMusicDetail: vi.fn(), getSource: vi.fn(), outbound: vi.fn(), cache: vi.fn(), persistent: vi.fn() }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: api.getSource }));
vi.mock('@/services/outboundHttp', () => ({ outboundRequest: api.outbound }));
vi.mock('@lx/tauri-bridge', () => ({ cacheRemoteImage: api.cache, saveManualCover: api.persistent, setAudioMetadata: vi.fn(), setAudioCover: vi.fn(), setAudioLyrics: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(), stat: vi.fn() }));
const candidate: MusicInfo = { id: '42', source: 'wy', name: '歌名', singer: '歌手', albumName: '专辑', interval: 234, picUrl: 'https://covers.test/42.png' };
beforeEach(() => {
  vi.resetAllMocks();
  api.getSource.mockReturnValue(api);
  api.search.mockResolvedValue({ songs: [candidate] });
  api.getLyric.mockResolvedValue({ lyric: '[00:01.00]第一句\n[00:02.00]第二句' });
  api.getMusicDetail.mockImplementation(async (song) => song);
  api.outbound.mockResolvedValue({ ok: true, status: 200, headers: { 'content-type': 'image/png' }, base64: () => 'iVBORw0KGgo=' });
  api.persistent.mockResolvedValue('C:\\data\\manual-covers\\cover.png');
});
describe('内置源手动匹配', () => {
  it('只用registry内置网易/QQ搜索，不自动取候选内容', async () => {
    expect(await searchManualMedia('wy', '  关键词  ')).toEqual([candidate]);
    expect(api.getSource).toHaveBeenCalledWith('wy');
    expect(api.search).toHaveBeenCalledWith('关键词', 'song', 1);
    expect(api.getLyric).not.toHaveBeenCalled();
    expect(api.outbound).not.toHaveBeenCalled();
  });
  it('拒绝空查询和非内置源，错误原样可见', async () => {
    await expect(searchManualMedia('wy', ' ')).rejects.toThrow('关键词');
    await expect(searchManualMedia('lx' as any, '歌')).rejects.toThrow('网易');
    api.search.mockRejectedValue(new Error('网络断开'));
    await expect(searchManualMedia('tx', '歌')).rejects.toThrow('网络断开');
  });
  it('歌词预览实际复用parser，保留原文本而不是第一条搜索结果', async () => {
    const lyric = await getManualLyrics(candidate);
    expect(api.getLyric).toHaveBeenCalledWith(candidate);
    expect(lyric.lines.map((line) => [line.time, line.text])).toEqual([[1, '第一句'], [2, '第二句']]);
    expect(lyric.raw).toContain('[00:01.00]');
  });
  it('空歌词和非法封面响应显式报错', async () => {
    api.getLyric.mockResolvedValue({});
    await expect(getManualLyrics(candidate)).rejects.toThrow('歌词');
    api.outbound.mockResolvedValue({ ok: false, status: 403 });
    await expect(getManualCover(candidate)).rejects.toThrow('403');
    await expect(getManualCover({ ...candidate, picUrl: 'file:///private/key' })).rejects.toThrow('HTTP');
  });
  it('封面通过出站代理预览，只在明确应用时缓存成本机短路径', async () => {
    const preview = await getManualCover(candidate);
    expect(preview.previewUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(api.cache).not.toHaveBeenCalled();
    const cover = await cacheManualCover(preview);
    expect(api.outbound).toHaveBeenCalledWith(candidate.picUrl, expect.objectContaining({ responseType: 'base64', maxBytes: 10 * 1024 * 1024 }));
    expect(api.persistent).toHaveBeenCalledWith(preview.previewUrl);
    expect(cover).toEqual({ path: 'C:\\data\\manual-covers\\cover.png', assetUrl: 'asset://C:\\data\\manual-covers\\cover.png' });
    expect(JSON.stringify(cover)).not.toContain('base64');
  });
  it('缓存失败不得假装应用成功，也不接受远程地址冒充缓存', async () => {
    const preview = await getManualCover(candidate);
    api.persistent.mockRejectedValue(new Error('磁盘已满'));
    await expect(cacheManualCover(preview)).rejects.toThrow('磁盘已满');
    api.persistent.mockResolvedValue('https://covers.test/not-local');
    await expect(cacheManualCover(preview)).rejects.toThrow('本机');
  });
});
it('手动歌词预览保留来源提供的译文与罗马音，不只留下原文', async () => {
  api.getLyric.mockResolvedValue({ lyric: '[00:01]原文', tlyric: '[00:01]翻译', romaLyric: '[00:01]roma' });
  const result = await getManualLyrics(candidate);
  expect(result).toMatchObject({ translation: '[00:01]翻译', romanization: '[00:01]roma' });
  expect(result.lines[0]).toMatchObject({ text: '原文', tr: '翻译', roma: 'roma' });
});

it('手动选择的封面存入用户数据，不依赖可被清理的自动缓存', async () => {
  api.persistent.mockResolvedValue('C:\\data\\manual-covers\\chosen.png');
  const preview = await getManualCover(candidate);
  const cover = await cacheManualCover(preview);
  expect(api.persistent).toHaveBeenCalledWith(preview.previewUrl);
  expect(api.cache).not.toHaveBeenCalled();
  expect(cover.path).toContain('manual-covers');
});
