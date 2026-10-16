import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getManualLyrics, searchManualMedia } from '../src/services/manualMediaMatchService';
import type { MusicInfo } from '@lx/core';

/**
 * 手动匹配只需要「搜索候选 + 取候选歌词」两件事：封面不再有候选可选
 * （本地曲封面只能来自音频文件自己的内嵌标签/同目录旁挂图），所以也没有任何
 * 显示封面、落盘封面的入口。
 */
const api = vi.hoisted(() => ({ search: vi.fn(), getLyric: vi.fn(), getSource: vi.fn() }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: api.getSource }));
vi.mock('@lx/tauri-bridge', () => ({ setAudioMetadata: vi.fn(), setAudioLyrics: vi.fn() }));

const candidate: MusicInfo = { id: '42', source: 'wy', name: '歌名', singer: '歌手', albumName: '专辑', interval: 234, picUrl: 'https://covers.test/42.png' };

beforeEach(() => {
  vi.resetAllMocks();
  api.getSource.mockReturnValue(api);
  api.search.mockResolvedValue({ songs: [candidate] });
  api.getLyric.mockResolvedValue({ lyric: '[00:01.00]第一句\n[00:02.00]第二句' });
});

describe('内置源手动匹配', () => {
  it('只用registry内置网易/QQ搜索，不自动取候选内容', async () => {
    expect(await searchManualMedia('wy', '  关键词  ')).toEqual([candidate]);
    expect(api.getSource).toHaveBeenCalledWith('wy');
    expect(api.search).toHaveBeenCalledWith('关键词', 'song', 1);
    expect(api.getLyric).not.toHaveBeenCalled();
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
  it('空歌词显式报错，不静默返回空预览', async () => {
    api.getLyric.mockResolvedValue({});
    await expect(getManualLyrics(candidate)).rejects.toThrow('歌词');
  });
});

it('手动歌词预览保留来源提供的译文与罗马音，不只留下原文', async () => {
  api.getLyric.mockResolvedValue({ lyric: '[00:01]原文', tlyric: '[00:01]翻译', romaLyric: '[00:01]roma' });
  const result = await getManualLyrics(candidate);
  expect(result).toMatchObject({ translation: '[00:01]翻译', romanization: '[00:01]roma' });
  expect(result.lines[0]).toMatchObject({ text: '原文', tr: '翻译', roma: 'roma' });
});
