import { beforeEach, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
const deps = vi.hoisted(() => ({ provider: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock('@/services/sources/sourceService', () => ({ getSource: () => ({ getLyric: deps.provider }) }));
vi.mock('@/services/persistentCache', () => ({
  getCachedLyrics: deps.read, saveCachedLyrics: deps.save,
  isCacheableEmptyLyricResult: (result: { error?: string }) => result.error === '暂无歌词',
}));
vi.mock('@lx/tauri-bridge', () => ({ debugLog: vi.fn() }));
import { clearLyricsMemoryCache, getLyrics, peekCachedLyrics } from '../src/services/lyricsService';
const track = (id: string) => ({ id, source: 'wy', name: id, singer: '歌手', albumName: '' }) as MusicInfo;
beforeEach(() => {
  clearLyricsMemoryCache(); vi.resetAllMocks();
  deps.read.mockResolvedValue(null); deps.save.mockResolvedValue(undefined);
});
it('同曲多个视图和预取并发只发一份请求、只写一次主曲缓存', async () => {
  let resolve!: (value: unknown) => void;
  deps.provider.mockReturnValue(new Promise(done => { resolve = done; }));
  const one = getLyrics(track('one'));
  const two = getLyrics(track('one'));
  await vi.waitFor(() => expect(deps.provider).toHaveBeenCalled());
  expect(deps.provider).toHaveBeenCalledTimes(1);
  resolve({ lyric: '[00:01]歌词' });
  expect(await one).toEqual(await two);
  expect(deps.save).toHaveBeenCalledTimes(1);
});
it('暂时失败不占用在途缓存，下一次请求可以重试', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  deps.provider.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ lyric: '[00:01]恢复' });
  expect((await getLyrics(track('retry'))).error).toBeTruthy();
  expect((await getLyrics(track('retry'))).lines[0].text).toBe('恢复');
  expect(deps.provider).toHaveBeenCalledTimes(2);
  log.mockRestore();
});
it('不同候选集合共享单曲请求，但仍分别选择本次候选的歌词', async () => {
  deps.provider.mockImplementation(async (music: MusicInfo) => ({ lyric: music.id === 'empty' ? '' : '[00:01]候选歌词' }));
  const primary = track('empty');
  const [empty, found] = await Promise.all([getLyrics(primary), getLyrics(primary, [track('variant')])]);
  expect(empty.lines).toEqual([]);
  expect(found.lines[0].text).toBe('候选歌词');
  expect(deps.provider.mock.calls.filter(([song]) => song.id === 'empty')).toHaveLength(1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('清理后旧请求结束不回填内存或磁盘，也不删除清理后新建的在途请求', async () => {
  const old = deferred<object>(), fresh = deferred<object>();
  deps.provider.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const music = track('clear');
  const oldRequest = getLyrics(music);
  await vi.waitFor(() => expect(deps.provider).toHaveBeenCalledTimes(1));
  clearLyricsMemoryCache();
  const newRequest = getLyrics(music);
  await vi.waitFor(() => expect(deps.provider).toHaveBeenCalledTimes(2));
  old.resolve({ lyric: '[00:01]过期歌词' });
  await oldRequest;
  expect(peekCachedLyrics(music)).toBeNull();
  expect(deps.save).not.toHaveBeenCalled();
  const sharedNewRequest = getLyrics(music);
  fresh.resolve({ lyric: '[00:01]新歌词' });
  expect((await newRequest).lines[0].text).toBe('新歌词');
  expect(await sharedNewRequest).toEqual(await newRequest);
  expect(deps.provider).toHaveBeenCalledTimes(2);
  expect(deps.save).toHaveBeenCalledTimes(1);
  expect(peekCachedLyrics(music)?.[0].text).toBe('新歌词');
});

it('旧持久化读取在清理后返回，不得覆盖随后写入的新歌词', async () => {
  const oldRead = deferred<any>();
  deps.read.mockReturnValueOnce(oldRead.promise).mockResolvedValue(null);
  deps.provider.mockResolvedValue({ lyric: '[00:01]更新后歌词' });
  const music = track('read');
  const oldRequest = getLyrics(music);
  clearLyricsMemoryCache();
  await getLyrics(music);
  oldRead.resolve({ lines: [{ time: 1, text: '磁盘旧歌词' }] });
  await oldRequest;
  expect(peekCachedLyrics(music)?.[0].text).toBe('更新后歌词');
  expect(deps.save).toHaveBeenCalledTimes(1);
});

it('清理后迟到的候选和空结果均不回写主曲别名', async () => {
  const candidate = deferred<object>();
  deps.provider.mockImplementation((music: MusicInfo) => music.id === 'primary' ? Promise.resolve({ lyric: '' }) : candidate.promise);
  const music = track('primary');
  const request = getLyrics(music, [track('variant')]);
  await vi.waitFor(() => expect(deps.provider).toHaveBeenCalledTimes(2));
  clearLyricsMemoryCache();
  deps.save.mockClear();
  candidate.resolve({ lyric: '[00:01]迟到候选' });
  await request;
  expect(peekCachedLyrics(music)).toBeNull();
  expect(peekCachedLyrics(track('variant'))).toBeNull();
  expect(deps.save).not.toHaveBeenCalled();
});

it.each(['empty', 'error'])('清理后旧 %s 不删除新请求已缓存的成功结果', async (outcome) => {
  const old = deferred<object>();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  deps.provider.mockReturnValueOnce(old.promise).mockResolvedValue({ lyric: '[00:01]新成功' });
  const music = track('error');
  const oldRequest = getLyrics(music);
  await vi.waitFor(() => expect(deps.provider).toHaveBeenCalledTimes(1));
  clearLyricsMemoryCache();
  await getLyrics(music);
  if (outcome === 'error') old.reject(new Error('old failure'));
  else old.resolve({ lyric: '' });
  await oldRequest;
  expect(peekCachedLyrics(music)?.[0].text).toBe('新成功');
  expect(deps.save).toHaveBeenCalledTimes(1);
  log.mockRestore();
});
