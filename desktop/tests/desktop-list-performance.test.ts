import { afterEach, expect, it, vi } from 'vitest';
import type { MusicSource, SearchResult } from '@lx/core';
import { createDesktopSearchSession } from '../src/services/search/pagedSearch';
import { createLyricAutoScrollController } from '../src/services/lyrics/autoScrollModel';

afterEach(() => vi.useRealTimers());

it('连续短歌词在 600ms 内推进到最新行，不会被后续行不断推迟', () => {
  vi.useFakeTimers();
  const scroll = vi.fn();
  const controller = createLyricAutoScrollController({ scroll });
  controller.setTarget(0);
  controller.setTarget(1);
  vi.advanceTimersByTime(200);
  controller.setTarget(2);
  vi.advanceTimersByTime(200);
  controller.setTarget(3);
  vi.advanceTimersByTime(200);
  expect(scroll).toHaveBeenLastCalledWith({ index: 3, durationMs: 600 });
  controller.beginUserScroll();
  controller.setTarget(4);
  controller.endUserScroll();
  vi.advanceTimersByTime(2999);
  expect(scroll).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1);
  expect(scroll).toHaveBeenLastCalledWith({ index: 4, durationMs: 0 });
  controller.setTarget(5);
  controller.setTarget(20);
  expect(scroll).toHaveBeenLastCalledWith({ index: 20, durationMs: 0 });
  vi.advanceTimersByTime(600);
  expect(scroll).toHaveBeenCalledTimes(4);
  controller.reanchor();
  expect(scroll).toHaveBeenLastCalledWith({ index: 20, durationMs: 0 });
  controller.dispose();
});

it('搜索状态和其他分类返回时保留已聚合歌曲引用，新增页只替换变更分类', async () => {
  let finishAlbum!: (value: SearchResult) => void;
  const album = new Promise<SearchResult>(resolve => { finishAlbum = resolve; });
  const provider = {
    id: 'wy', supportedSearchTypes: ['song', 'album'],
    search: vi.fn(async (_keyword: string, category: string, page: number) => category === 'album'
      ? album : { songs: [{ id: String(page), source: 'wy', name: `Song ${page}`, singer: 'Singer' }], hasMore: page < 2 }),
  } as unknown as MusicSource;
  const session = createDesktopSearchSession('song', [provider]);
  const started = session.start();
  await Promise.resolve();
  await Promise.resolve();
  const songs = session.getSnapshot().result.songs;
  expect(songs).toHaveLength(1);
  finishAlbum({ albums: [{ id: 'album', source: 'wy', name: 'Album' }], hasMore: false });
  await started;
  const result = session.getSnapshot().result;
  expect(result.songs).toBe(songs);
  const loading = session.loadMore('song');
  expect(session.getSnapshot().result).toBe(result);
  await loading;
  expect(session.getSnapshot().result.songs).toHaveLength(2);
  expect(session.getSnapshot().result.albums).toBe(result.albums);
  session.dispose();
});
