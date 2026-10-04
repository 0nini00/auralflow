import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
const deps = vi.hoisted(() => ({ getSource: vi.fn(), getCachedLyrics: vi.fn(), saveCachedLyrics: vi.fn(), fetch: vi.fn() }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: deps.getSource }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: deps.fetch }));
vi.mock('@/services/persistentCache', () => ({ getCachedLyrics: deps.getCachedLyrics, saveCachedLyrics: deps.saveCachedLyrics, isCacheableEmptyLyricResult: () => false }));
import { __lyricsInternals, getLyrics } from '../src/services/lyricsService';
let id = 0;
const music = (extra = {}) => ({ id: `annotation-${++id}`, source: 'wy', name: '日', singer: '歌手', ...extra }) as MusicInfo;
beforeEach(() => {
  vi.resetAllMocks();
  deps.getCachedLyrics.mockResolvedValue(null);
  deps.saveCachedLyrics.mockResolvedValue(undefined);
  deps.getSource.mockReturnValue({ getLyric: vi.fn().mockResolvedValue({ lyric: '[00:01]日', romaLyric: '[00:01]hi', tlyric: '[00:01]太阳' }) });
});
describe('歌词来源及手动覆盖优先级', () => {
  it('音源 romaLyric 与翻译一并传递', async () => {
    expect((await getLyrics(music())).lines[0]).toMatchObject({ roma: 'hi', tr: '太阳' });
  });
  it('覆盖必须先于持久化缓存及旧 lyrics 字段且不污染自动缓存', async () => {
    deps.getCachedLyrics.mockResolvedValue({ lines: [{ time: 1, text: '旧缓存' }] });
    const track = music({ source: 'local', lyrics: '[00:01]旧内嵌', localLyrics: '[00:02]<ruby>新<rt>しん</rt></ruby>' });
    expect((await getLyrics(track)).lines[0]).toMatchObject({ time: 2, text: '新', ruby: [{ text: '新', reading: 'しん' }] });
    expect(deps.getCachedLyrics).not.toHaveBeenCalled();
    expect(deps.saveCachedLyrics).not.toHaveBeenCalled();
    expect(deps.getSource).not.toHaveBeenCalled();
  });
  it('同曲的新覆盖先于自动内存缓存，移除覆盖后仍可回到自动歌词', async () => {
    const track = music();
    await getLyrics(track);
    expect((await getLyrics({ ...track, localLyrics: '[00:02]手动' })).lines[0].text).toBe('手动');
    expect((await getLyrics(track)).lines[0].text).toBe('日');
  });
  it('不能解析的非空覆盖显式报错而不取自动词', async () => {
    const result = await getLyrics(music({ localLyrics: '无时间也不是可识别歌词格式' }));
    expect(result.lines).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(deps.getSource).not.toHaveBeenCalled();
  });
  it('单来源入口也保持覆盖优先级', async () => {
    deps.getCachedLyrics.mockResolvedValue({ lines: [{ time: 1, text: '旧缓存' }] });
    expect((await __lyricsInternals.getLyricsForSingle(music({ localLyrics: '[00:01]手动' }))).lines[0].text).toBe('手动');
  });
});

it.each(['', '   \n\t'])('显式清空 %j 优先于持久化缓存、内嵌词及所有自动来源', async (localLyrics) => {
  deps.getCachedLyrics.mockResolvedValue({ lines: [{ time: 1, text: '旧缓存' }] });
  const track = music({ source: 'local', lyrics: '[00:01]旧内嵌', localLyrics });
  expect(await getLyrics(track, [music()])).toEqual({ lines: [] });
  expect(await __lyricsInternals.getLyricsForSingle(track)).toEqual({ lines: [] });
  expect(deps.getCachedLyrics).not.toHaveBeenCalled();
  expect(deps.saveCachedLyrics).not.toHaveBeenCalled();
  expect(deps.getSource).not.toHaveBeenCalled();
  expect(deps.fetch).not.toHaveBeenCalled();
});
it('显式清空优先于已命中的内存缓存，只有 undefined 才恢复自动词', async () => {
  const track = music();
  await getLyrics(track);
  vi.clearAllMocks();
  expect(await getLyrics({ ...track, localLyrics: '' })).toEqual({ lines: [] });
  expect(deps.getSource).not.toHaveBeenCalled();
  expect(deps.getCachedLyrics).not.toHaveBeenCalled();
  expect(deps.saveCachedLyrics).not.toHaveBeenCalled();
  expect((await getLyrics({ ...track, localLyrics: undefined })).lines[0].text).toBe('日');
});
it('手动候选的翻译和罗马音按时间合并，原文、注音和逐字时间不丢失', async () => {
  const track = music({
    source: 'local',
    localLyrics: '[00:01]<00:01><ruby>日<rt>ひ</rt></ruby><00:02>へ',
    localLyricsTranslation: '[00:01]向着太阳',
    localLyricsRomanization: '[00:01]hi e',
  });
  const result = await getLyrics(track);
  expect(result.lines[0]).toMatchObject({
    time: 1, text: '日へ', tr: '向着太阳', roma: 'hi e',
    ruby: [{ text: '日', reading: 'ひ' }, { text: 'へ' }],
    words: [{ text: '日', start: 1, dur: 1, reading: 'ひ' }, { text: 'へ', start: 2 }],
  });
  expect(deps.getCachedLyrics).not.toHaveBeenCalled();
  expect(deps.saveCachedLyrics).not.toHaveBeenCalled();
  expect(deps.getSource).not.toHaveBeenCalled();
});
it('原文显式清空时，保留的辅助轨不能恢复歌词或触发自动来源', async () => {
  expect(await getLyrics(music({
    localLyrics: '', localLyricsTranslation: '[00:01]翻译', localLyricsRomanization: '[00:01]roma',
  }))).toEqual({ lines: [] });
  expect(deps.getCachedLyrics).not.toHaveBeenCalled();
  expect(deps.getSource).not.toHaveBeenCalled();
});
