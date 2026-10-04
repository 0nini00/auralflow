import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';
import { useWyAccountStore } from '../src/stores/wyAccountStore';

const api = vi.hoisted(() => ({
  check: vi.fn(), lists: vi.fn(), songs: vi.fn(), patch: vi.fn(),
  add: vi.fn(), remove: vi.fn(), subscribe: vi.fn(), cookie: '',
}));
vi.mock('@lx/tauri-bridge', () => ({ patchSettings: api.patch }));
vi.mock('@/services/wyAccountService', () => ({
  setWyCookie: (value: string) => { api.cookie = value; return value; },
  getWyCookie: async () => api.cookie,
  checkAccount: api.check, getUserPlaylists: api.lists, getPlaylistDetail: api.songs,
  addPlaylistTracks: api.add, removePlaylistTracks: api.remove, subscribePlaylist: api.subscribe,
  getWyTrackId: (song: MusicInfo) => song.source === 'wy' ? String(song.id) : null,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const song = (name: string): MusicInfo => ({ id: 'track', source: 'wy', name, singer: 'Artist', interval: 100 } as MusicInfo);
const account = (uid: string) => ({ uid, nickname: uid });
const lists = (uid: string, subscribed = false) => [{ id: 'shared', name: `${uid}-playlist`, trackCount: 5, subscribed }];
const store = () => useWyAccountStore.getState();
async function login(uid: string) {
  api.check.mockResolvedValueOnce(account(uid));
  api.lists.mockResolvedValueOnce(lists(uid));
  await store().load(`cookie-${uid}`);
}
async function beginLoginWithPendingLists(uid: string) {
  const pending = deferred<ReturnType<typeof lists>>();
  api.check.mockResolvedValueOnce(account(uid));
  api.lists.mockImplementationOnce(() => pending.promise);
  const loading = store().load(`cookie-${uid}`);
  await vi.waitFor(() => expect(store().account?.uid).toBe(uid));
  return { pending, loading };
}
beforeEach(async () => {
  api.patch.mockReset().mockResolvedValue(undefined);
  await store().logout();
  vi.clearAllMocks();
  api.check.mockReset(); api.lists.mockReset(); api.songs.mockReset();
  api.add.mockReset().mockResolvedValue(undefined);
  api.remove.mockReset().mockResolvedValue(undefined);
  api.subscribe.mockReset().mockResolvedValue(undefined);
});

describe('真实网易云 store 的账号世代隔离', () => {
  it.each(['get', 'preload', 'refresh'] as const)('%s 的 A 在途请求不能被 B 的同 ID 歌单复用', async (operation) => {
    await login('A');
    const a = deferred<MusicInfo[]>(), b = deferred<MusicInfo[]>();
    api.songs.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
    const old = operation === 'preload' ? store().preloadPlaylistSongs('shared')
      : operation === 'refresh' ? store().refreshPlaylistSongs('shared') : store().getPlaylistSongs('shared');
    const loginB = await beginLoginWithPendingLists('B');
    const current = store().getPlaylistSongs('shared');
    expect(api.songs).toHaveBeenCalledTimes(2);
    b.resolve([song('B-song')]); a.resolve([song('A-song')]);
    expect(await current).toEqual([song('B-song')]);
    await old;
    loginB.pending.resolve(lists('B')); await loginB.loading;
    expect(await store().getPlaylistSongs('shared')).toEqual([song('B-song')]);
    expect(api.songs).toHaveBeenCalledTimes(2);
  });

  it('切账号立即丢弃已完成缓存，不等待新账号歌单列表', async () => {
    await login('A');
    api.songs.mockResolvedValueOnce([song('A-cached')]).mockResolvedValueOnce([song('B-song')]);
    await store().getPlaylistSongs('shared');
    const loginB = await beginLoginWithPendingLists('B');
    expect(await store().getPlaylistSongs('shared')).toEqual([song('B-song')]);
    loginB.pending.resolve(lists('B')); await loginB.loading;
  });

  it('退出在持久化等待期间即失效；迟到的退出不能清除随后登录的 B', async () => {
    await login('A');
    const a = deferred<MusicInfo[]>(), persisted = deferred<void>();
    api.songs.mockImplementationOnce(() => a.promise).mockResolvedValueOnce([song('B-song')]);
    const old = store().getPlaylistSongs('shared');
    api.patch.mockImplementationOnce(() => persisted.promise);
    const loggingOut = store().logout();
    expect(store().account).toBeNull();
    expect(store().playlists).toEqual([]);
    await login('B');
    expect(await store().getPlaylistSongs('shared')).toEqual([song('B-song')]);
    persisted.resolve(); a.resolve([song('A-late')]);
    await loggingOut; await old;
    expect(store().account?.uid).toBe('B');
    expect(api.cookie).toBe('cookie-B');
    expect(await store().getPlaylistSongs('shared')).toEqual([song('B-song')]);
  });

  it.each(['success', 'failure'] as const)('旧登录校验 %s 不得覆盖新账号或清其 Cookie', async (outcome) => {
    const oldCheck = deferred<ReturnType<typeof account>>();
    api.check.mockImplementationOnce(() => oldCheck.promise);
    const oldLoad = store().load('cookie-A');
    await login('B');
    if (outcome === 'success') oldCheck.resolve(account('A'));
    else oldCheck.reject(new Error('Cookie 过期，请重新登录'));
    await oldLoad;
    expect(store().account?.uid).toBe('B');
    expect(store().playlists).toEqual(lists('B'));
    expect(store().error).toBe('');
    expect(api.cookie).toBe('cookie-B');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('旧账号歌单刷新 %s 不得覆盖 B 的列表/错误/缓存', async (outcome) => {
    await login('A');
    const oldLists = deferred<ReturnType<typeof lists>>();
    api.lists.mockImplementationOnce(() => oldLists.promise);
    const refresh = store().refreshPlaylists();
    await login('B');
    api.songs.mockResolvedValue([song('B-cached')]);
    await store().getPlaylistSongs('shared');
    if (outcome === 'success') oldLists.resolve(lists('A'));
    else oldLists.reject(new Error('A refresh failed'));
    await refresh;
    expect(store().playlists).toEqual(lists('B'));
    expect(store().error).toBe('');
    expect(await store().getPlaylistSongs('shared')).toEqual([song('B-cached')]);
    expect(api.songs).toHaveBeenCalledTimes(1);
  });

  it.each(['add', 'remove', 'unsubscribe'] as const)('旧账号 %s 响应不能修改 B 的同 ID 歌单', async (operation) => {
    await login('A');
    if (operation === 'unsubscribe') useWyAccountStore.setState({ playlists: lists('A', true) as any });
    const pending = deferred<void>();
    const method = operation === 'add' ? api.add : operation === 'remove' ? api.remove : api.subscribe;
    method.mockImplementationOnce(() => pending.promise);
    const mutation = operation === 'add' ? store().addTracks('shared', [song('A-added')])
      : operation === 'remove' ? store().removeTracks('shared', [song('A-removed')]) : store().setSubscribed('shared', false);
    await login('B');
    api.songs.mockResolvedValueOnce([song('B-cached')]);
    await store().getPlaylistSongs('shared');
    pending.resolve(); await mutation;
    expect(store().playlists).toEqual(lists('B'));
    expect(await store().getPlaylistSongs('shared')).toEqual([song('B-cached')]);
  });

  it('旧收藏触发的列表响应不能覆盖新账号', async () => {
    await login('A');
    const oldLists = deferred<ReturnType<typeof lists>>();
    api.lists.mockImplementationOnce(() => oldLists.promise);
    const subscribed = store().setSubscribed('shared', true);
    await vi.waitFor(() => expect(api.lists).toHaveBeenCalledTimes(2));
    await login('B');
    oldLists.resolve(lists('A')); await subscribed;
    expect(store().playlists).toEqual(lists('B'));
  });

  it('同账号仍合并请求，强制刷新后旧请求不能覆盖缓存或删除新在途请求', async () => {
    await login('A');
    const first = deferred<MusicInfo[]>(), refreshed = deferred<MusicInfo[]>();
    api.songs.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => refreshed.promise);
    const initial = store().getPlaylistSongs('shared');
    const duplicate = store().getPlaylistSongs('shared');
    expect(api.songs).toHaveBeenCalledTimes(1);
    const refresh = store().refreshPlaylistSongs('shared');
    first.resolve([song('Old')]); await initial; await duplicate;
    const duringRefresh = store().getPlaylistSongs('shared');
    expect(api.songs).toHaveBeenCalledTimes(2);
    refreshed.resolve([song('New')]);
    expect(await duringRefresh).toEqual([song('New')]); await refresh;
    expect(await store().getPlaylistSongs('shared')).toEqual([song('New')]);
    expect(api.songs).toHaveBeenCalledTimes(2);
  });

  it('退出后重新登录同 uid 也是新世代', async () => {
    await login('A');
    const old = deferred<MusicInfo[]>();
    api.songs.mockImplementationOnce(() => old.promise).mockResolvedValueOnce([song('New-session')]);
    const request = store().getPlaylistSongs('shared');
    await store().logout(); await login('A');
    await store().getPlaylistSongs('shared');
    old.resolve([song('Old-session')]); await request;
    expect(await store().getPlaylistSongs('shared')).toEqual([song('New-session')]);
  });

  it.each(['success', 'failure'] as const)('旧登录列表 %s 不能结束 B 的加载或覆盖其状态', async (outcome) => {
    const loginA = await beginLoginWithPendingLists('A');
    const loginB = await beginLoginWithPendingLists('B');
    if (outcome === 'success') loginA.pending.resolve(lists('A'));
    else loginA.pending.reject(new Error('A list failed'));
    await loginA.loading;
    expect(store().account?.uid).toBe('B');
    expect(store().playlists).toEqual([]);
    expect(store().isLoading).toBe(true);
    expect(store().error).toBe('');
    loginB.pending.resolve(lists('B')); await loginB.loading;
  });

  it('旧歌曲请求失败清理时不能删除 B 的在途请求', async () => {
    await login('A');
    const a = deferred<MusicInfo[]>(), b = deferred<MusicInfo[]>();
    api.songs.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
    const old = store().getPlaylistSongs('shared');
    const rejection = expect(old).rejects.toThrow('A songs failed');
    await login('B');
    const current = store().getPlaylistSongs('shared');
    a.reject(new Error('A songs failed')); await rejection;
    const duplicate = store().getPlaylistSongs('shared');
    expect(api.songs).toHaveBeenCalledTimes(2);
    b.resolve([song('B-song')]);
    expect(await current).toEqual([song('B-song')]);
    expect(await duplicate).toEqual([song('B-song')]);
  });

  it('注销写盘拒绝恢复 Cookie、账号和列表，但不恢复旧缓存或旧在途世代', async () => {
    await login('A');
    const oldSongs = deferred<MusicInfo[]>(), persisted = deferred<void>();
    api.songs.mockResolvedValueOnce([song('A-cached')]).mockImplementationOnce(() => oldSongs.promise)
      .mockResolvedValueOnce([song('A-fresh')]).mockResolvedValueOnce([song('A-current')]);
    await store().getPlaylistSongs('shared');
    const oldRequest = store().getPlaylistSongs('pending');
    api.patch.mockImplementationOnce(() => persisted.promise);
    const logout = store().logout();
    const failure = expect(logout).rejects.toThrow('settings write failed');
    expect(store().account).toBeNull();
    expect(store().playlists).toEqual([]);
    expect(api.cookie).toBe('');
    persisted.reject(new Error('settings write failed')); await failure;
    expect(store().account).toEqual(account('A'));
    expect(store().playlists).toEqual(lists('A'));
    expect(store().isLoading).toBe(false);
    expect(api.cookie).toBe('cookie-A');
    expect(await store().getPlaylistSongs('shared')).toEqual([song('A-fresh')]);
    const current = store().getPlaylistSongs('pending');
    expect(api.songs).toHaveBeenCalledTimes(4);
    expect(await current).toEqual([song('A-current')]);
    oldSongs.resolve([song('A-obsolete')]); await oldRequest;
    expect(await store().getPlaylistSongs('pending')).toEqual([song('A-current')]);
  });

  it.each(['ready', 'checking'] as const)('注销失败迟到不能覆盖期间的新登录（%s）', async (phase) => {
    await login('A');
    const persisted = deferred<void>(), checkB = deferred<ReturnType<typeof account>>();
    api.patch.mockImplementationOnce(() => persisted.promise);
    const logout = store().logout();
    const failure = expect(logout).rejects.toThrow('late logout failure');
    let loginB: Promise<void> | undefined;
    if (phase === 'ready') {
      await login('B');
    } else {
      api.check.mockImplementationOnce(() => checkB.promise);
      api.lists.mockResolvedValueOnce(lists('B'));
      loginB = store().load('cookie-B');
    }
    persisted.reject(new Error('late logout failure')); await failure;
    expect(api.cookie).toBe('cookie-B');
    if (phase === 'checking') {
      expect(store().account).toBeNull();
      expect(store().isLoading).toBe(true);
      checkB.resolve(account('B')); await loginB;
    }
    expect(store().account).toEqual(account('B'));
    expect(store().playlists).toEqual(lists('B'));
  });

});
