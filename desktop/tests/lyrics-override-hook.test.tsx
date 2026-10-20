import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
const deps = vi.hoisted(() => ({ getLyrics: vi.fn(), getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('@/services/lyricsService', async (original) => ({ ...await original<object>(), getLyrics: deps.getLyrics }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: vi.fn() }));
vi.mock('@/services/persistentCache', () => ({ getCachedLyrics: vi.fn(), saveCachedLyrics: vi.fn(), isCacheableEmptyLyricResult: () => false }));
import { useLyrics } from '../src/hooks/useLyrics';
const track = { id: 'one', source: 'local', name: '歌', singer: '人' } as MusicInfo;
const online = { id: 'two', source: 'wy', name: '歌', singer: '人' } as MusicInfo;
let renderer: ReactTestRenderer;
let latest: ReturnType<typeof useLyrics>;
function Probe({ music }: { music: MusicInfo }) { latest = useLyrics(music, 1); return <div>{latest.lyrics.map(line => line.text).join('')}</div>; }
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('window', { localStorage: deps }); });
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

/**
 * 本地曲的歌词只来自文件自己：内嵌/旁挂文本写进 `localLyrics`，用户手写的按曲文本也走同一个字段。
 *
 * 平台匹配删除后最关键的契约是「**本地曲完全不走网络**」：没有词就是没有词，
 * 既不读共享缓存也不发请求——所以下面每个用例都同时断言 getLyrics / getItem 没被调用。
 */
it('本地曲手写词立即生效，且全程不取词、不读共享缓存', async () => {
  await act(async () => { renderer = create(<Probe music={{ ...track, localLyrics: '[00:01]手动一' }} />); });
  expect(latest!.lyrics[0]?.text).toBe('手动一');
  await act(async () => { renderer.update(<Probe music={{ ...track, localLyrics: '[00:01]手动二' }} />); });
  expect(latest!.lyrics[0]?.text).toBe('手动二');
  expect(deps.getLyrics).not.toHaveBeenCalled();
  expect(deps.getItem).not.toHaveBeenCalled();
});

it('移除手写词后是「本地文件没有歌词」，不回落到缓存或网络', async () => {
  deps.getItem.mockReturnValue(JSON.stringify({ lines: [{ time: 1, text: '缓存' }] }));
  deps.getLyrics.mockResolvedValue({ lines: [{ time: 1, text: '网络' }] });
  await act(async () => { renderer = create(<Probe music={{ ...track, localLyrics: '[00:01]手动' }} />); });
  await act(async () => { renderer.update(<Probe music={track} />); });
  expect(latest!.lyrics).toEqual([]);
  expect(latest!.error).toBe('本地文件没有歌词');
  expect(deps.getLyrics).not.toHaveBeenCalled();
  expect(deps.getItem).not.toHaveBeenCalled();
});

it('空串（用户主动清除）显示无歌词，不联网', async () => {
  deps.getItem.mockReturnValue(JSON.stringify({ lines: [{ time: 1, text: '缓存' }] }));
  deps.getLyrics.mockResolvedValue({ lines: [{ time: 1, text: '网络' }] });
  await act(async () => { renderer = create(<Probe music={{ ...track, localLyrics: '' }} />); });
  expect(latest!.lyrics).toEqual([]);
  expect(latest!.error).toBe('本地文件没有歌词');
  expect(deps.getLyrics).not.toHaveBeenCalled();
  expect(deps.getItem).not.toHaveBeenCalled();
});

it('清空后改回手写词立即恢复', async () => {
  await act(async () => { renderer = create(<Probe music={{ ...track, localLyrics: '[00:01]原文' }} />); });
  await act(async () => { renderer.update(<Probe music={{ ...track, localLyrics: '' }} />); });
  expect(latest!.lyrics).toEqual([]);
  await act(async () => { renderer.update(<Probe music={{ ...track, localLyrics: '[00:01]改回' }} />); });
  expect(latest!.lyrics[0]?.text).toBe('改回');
  expect(deps.getLyrics).not.toHaveBeenCalled();
});

it('在线曲换歌时，上一首的在途结果不能回写到新曲', async () => {
  const pending: ((value: unknown) => void)[] = [];
  deps.getLyrics.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
  await act(async () => { renderer = create(<Probe music={online} />); });
  await act(async () => { renderer.update(<Probe music={{ ...online, id: 'three' }} />); });
  await act(async () => { pending[0]({ lines: [{ time: 1, text: '上一首' }] }); });
  expect(latest!.lyrics.map(line => line.text)).not.toContain('上一首');
});

it('非空无时间戳覆盖显示明确错误，不复用旧词', async () => {
  deps.getItem.mockReturnValue(JSON.stringify({ lines: [{ time: 1, text: '旧缓存' }] }));
  await act(async () => { renderer = create(<Probe music={{ ...track, localLyrics: '无时间戳原文' }} />); });
  expect(latest!.lyrics).toEqual([]);
  expect(latest!.error).toBe('本地歌词无法解析');
  expect(deps.getItem).not.toHaveBeenCalled();
  expect(deps.getLyrics).not.toHaveBeenCalled();
});

it.each([
  ['localLyricsRomanization', 'roma', 'hi', 'hi e'],
  ['localLyricsTranslation', 'tr', '太阳', '向着太阳'],
] as const)('同曲只改 %s 即重新合并，清空辅助轨也不残留旧值', async (field, lineField, first, second) => {
  const manual = { ...track, localLyrics: '[00:01]日へ' };
  await act(async () => { renderer = create(<Probe music={manual} />); });
  expect(latest!.lyrics[0].text).toBe('日へ');
  await act(async () => { renderer.update(<Probe music={{ ...manual, [field]: `[00:01]${first}` }} />); });
  expect(latest!.lyrics[0][lineField]).toBe(first);
  await act(async () => { renderer.update(<Probe music={{ ...manual, [field]: `[00:01]${second}` }} />); });
  expect(latest!.lyrics[0][lineField]).toBe(second);
  await act(async () => { renderer.update(<Probe music={{ ...manual, [field]: '' }} />); });
  expect(latest!.lyrics[0]).not.toHaveProperty(lineField);
  expect(latest!.lyrics[0].text).toBe('日へ');
  expect(deps.getItem).not.toHaveBeenCalled();
  expect(deps.getLyrics).not.toHaveBeenCalled();
  expect(deps.setItem).not.toHaveBeenCalled();
});
