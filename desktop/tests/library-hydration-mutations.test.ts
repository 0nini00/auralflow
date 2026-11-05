import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@lx/tauri-bridge', () => ({ libraryLoad: storage.load, librarySave: storage.save }));
const a = { id: 'a', source: 'wy', name: 'A', singer: 'Singer' } as MusicInfo;
const b = { ...a, id: 'b', name: 'B' };

beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers(); storage.save.mockResolvedValue(undefined); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function pendingFavorites() {
  let finish!: (slice: unknown) => void;
  storage.load.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const store = await import('../src/stores/favoritesStore');
  return { ...store, finish };
}

it('启动读盘前新增收藏保留已有收藏，读盘之前不写入空基线', async () => {
  const { useFavoritesStore, favoritesPersistence, finish } = await pendingFavorites();
  useFavoritesStore.getState().addFavorite(b);
  await vi.advanceTimersByTimeAsync(1000);
  expect(storage.save).not.toHaveBeenCalled();
  finish({ favorites: [a] });
  await favoritesPersistence.ready;
  expect(useFavoritesStore.getState().favorites).toEqual([b, a]);
  await favoritesPersistence.flush();
  expect(storage.save).toHaveBeenLastCalledWith('favorites', { favorites: [b, a] });
});

it('启动期间删除与新增按用户顺序应用到完整磁盘基线', async () => {
  const { useFavoritesStore, favoritesPersistence, finish } = await pendingFavorites();
  useFavoritesStore.getState().removeFavorite(a);
  useFavoritesStore.getState().addFavorite(b);
  finish({ favorites: [a] });
  await favoritesPersistence.ready;
  expect(useFavoritesStore.getState().favorites).toEqual([b]);
});

it('启动读盘未结束时 flush 等待初始化，失败后拒绝且不提交临时空基线', async () => {
  let reject!: (error: Error) => void;
  storage.load.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { useFavoritesStore, favoritesPersistence } = await import('../src/stores/favoritesStore');
  useFavoritesStore.getState().addFavorite(b);
  let flushed = false;
  const flush = favoritesPersistence.flush();
  const rejection = expect(flush).rejects.toThrow('读盘失败');
  void flush.then(() => { flushed = true; }, () => { flushed = true; });
  await vi.advanceTimersByTimeAsync(1000);
  expect(flushed).toBe(false);
  expect(storage.save).not.toHaveBeenCalled();
  reject(new Error('读盘失败'));
  await rejection;
  expect(favoritesPersistence.loadError?.message).toBe('读盘失败');
  expect(storage.save).not.toHaveBeenCalled();
});

it('启动期间清空收藏仍表示清空完整集合', async () => {
  const { useFavoritesStore, favoritesPersistence, finish } = await pendingFavorites();
  useFavoritesStore.getState().clearFavorites();
  finish({ favorites: [a] });
  await favoritesPersistence.ready;
  expect(useFavoritesStore.getState().favorites).toEqual([]);
});

it('启动期间切换已有收藏按完整集合判断，不能错误变成添加', async () => {
  const { useFavoritesStore, favoritesPersistence, finish } = await pendingFavorites();
  useFavoritesStore.getState().toggleFavorite(a);
  finish({ favorites: [a] });
  await favoritesPersistence.ready;
  expect(useFavoritesStore.getState().favorites).toEqual([]);
});

it('历史写入和新建歌单在读盘完成后仍保留已有数据', async () => {
  const loads = new Map<string, (slice: unknown) => void>();
  storage.load.mockImplementation((namespace: string) => new Promise((resolve) => { loads.set(namespace, resolve); }));
  const { useHistoryStore, historyPersistence } = await import('../src/stores/historyStore');
  const { usePlaylistStore, playlistPersistence } = await import('../src/stores/playlistStore');
  useHistoryStore.getState().add(b);
  const created = usePlaylistStore.getState().createPlaylist('new');
  const existing = { id: 'old', name: 'old', songs: [a], createdAt: 1, updatedAt: 1 };
  loads.get('recent')!({ history: [a], playedAtByKey: { 'wy:a': 1 } });
  loads.get('playlists')!({ playlists: [existing] });
  await Promise.all([historyPersistence.ready, playlistPersistence.ready]);
  expect(useHistoryStore.getState().history).toEqual([b, a]);
  expect(useHistoryStore.getState().playedAtByKey['wy:a']).toBe(1);
  expect(usePlaylistStore.getState().playlists).toEqual([existing, created]);
});
