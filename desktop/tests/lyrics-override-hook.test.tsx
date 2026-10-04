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
let renderer: ReactTestRenderer;
let latest: ReturnType<typeof useLyrics>;
function Probe({ music }: { music: MusicInfo }) { latest = useLyrics(music, 1); return <div>{latest.lyrics.map(line => line.text).join('')}</div>; }
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('window', { localStorage: deps }); });
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
it('同曲换手动词立即生效，旧网络不能回写或写入共享缓存', async () => {
  let resolve!: (value: unknown) => void;
  deps.getLyrics.mockReturnValue(new Promise(yes => { resolve = yes; }));
  await act(async () => { renderer = create(<Probe music={track} />); });
  await act(async () => { renderer.update(<Probe music={{ ...track, localLyrics: '[00:01]新手动' }} />); });
  expect(latest!.lyrics[0]?.text).toBe('新手动');
  await act(async () => { resolve({ lines: [{ time: 1, text: '旧自动' }] }); });
  expect(latest!.lyrics[0]?.text).toBe('新手动');
  expect(deps.setItem).not.toHaveBeenCalled();
  expect(deps.getLyrics).toHaveBeenCalledTimes(1);
});
it('初次手动覆盖不读取共享旧缓存，切换新词立即重新解析', async () => {
  deps.getItem.mockReturnValue(JSON.stringify({ lines: [{ time: 1, text: '缓存' }] }));
  deps.getLyrics.mockResolvedValue({ lines: [{ time: 1, text: '网络' }] });
  await act(async () => { renderer = create(<Probe music={{ ...track, localLyrics: '[00:01]手动一' }} />); });
  expect(latest!.lyrics[0]?.text).toBe('手动一');
  await act(async () => { renderer.update(<Probe music={{ ...track, localLyrics: '[00:01]手动二' }} />); });
  expect(latest!.lyrics[0]?.text).toBe('手动二');
  expect(deps.getItem).not.toHaveBeenCalled();
  expect(deps.getLyrics).not.toHaveBeenCalled();
});
it('移除覆盖重新走原自动歌词流程', async () => {
  deps.getLyrics.mockResolvedValue({ lines: [{ time: 1, text: '自动' }] });
  await act(async () => { renderer = create(<Probe music={{ ...track, localLyrics: '[00:01]手动' }} />); });
  deps.getLyrics.mockClear();
  await act(async () => { renderer.update(<Probe music={track} />); });
  expect(deps.getLyrics).toHaveBeenCalledOnce();
  expect(latest!.lyrics[0]?.text).toBe('自动');
});

it('初次空串覆盖不读共享缓存，且不重新获取自动歌词', async () => {
  deps.getItem.mockReturnValue(JSON.stringify({ lines: [{ time: 1, text: '旧缓存' }] }));
  deps.getLyrics.mockResolvedValue({ lines: [{ time: 1, text: '旧自动' }] });
  await act(async () => { renderer = create(<Probe music={{ ...track, localLyrics: '' }} />); });
  expect(latest!.lyrics).toEqual([]);
  expect(latest!.error).toBeNull();
  expect(latest!.isLoading).toBe(false);
  expect(deps.getItem).not.toHaveBeenCalled();
  expect(deps.getLyrics).not.toHaveBeenCalled();
  expect(deps.setItem).not.toHaveBeenCalled();
});
it('同曲主动清空立即清除原文，清空后只有 undefined 才恢复自动流程', async () => {
  deps.getLyrics.mockResolvedValue({ lines: [{ time: 1, text: '自动' }] });
  await act(async () => { renderer = create(<Probe music={{ ...track, localLyrics: '[00:01]手动' }} />); });
  await act(async () => { renderer.update(<Probe music={{ ...track, localLyrics: '' }} />); });
  expect(latest!.lyrics).toEqual([]);
  expect(renderer.toJSON()).toMatchObject({ type: 'div', children: null });
  expect(deps.getLyrics).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<Probe music={{ ...track, localLyrics: undefined }} />); });
  expect(latest!.lyrics[0]?.text).toBe('自动');
  expect(deps.getLyrics).toHaveBeenCalledOnce();
});
it('清空时隔离正在返回的旧自动歌词，不回写共享缓存', async () => {
  let resolve!: (value: unknown) => void;
  deps.getLyrics.mockReturnValue(new Promise(yes => { resolve = yes; }));
  await act(async () => { renderer = create(<Probe music={track} />); });
  await act(async () => { renderer.update(<Probe music={{ ...track, localLyrics: '' }} />); });
  expect(latest!.isLoading).toBe(false);
  await act(async () => { resolve({ lines: [{ time: 1, text: '旧自动' }] }); });
  expect(latest!.lyrics).toEqual([]);
  expect(deps.getLyrics).toHaveBeenCalledTimes(1);
  expect(deps.setItem).not.toHaveBeenCalled();
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
