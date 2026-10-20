import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicInfo } from '@lx/core';

/**
 * 云盘落盘缓存的契约。
 *
 * 这份缓存是账号私有内容，所以每个用例背后都对应一条硬规则：按 uid 分区、10 分钟保鲜、
 * 结构坏了就当作没有、退出登录必须删、空列表不落盘（否则会把「当时为空」固化）。
 */

const store = vi.hoisted(() => ({ files: new Map<string, unknown>() }));

vi.mock('@lx/tauri-bridge', () => ({
  libraryLoad: async (namespace: string) => store.files.get(namespace) ?? null,
  librarySave: async (namespace: string, value: unknown) => { store.files.set(namespace, value); },
}));

const { CLOUD_DRIVE_CACHE_TTL_MS, clearCloudDriveSnapshot, loadCloudDriveSnapshot, saveCloudDriveSnapshot } =
  await import('../src/services/cloudDriveCache');

const song = (id: string): MusicInfo => ({ id, source: 'wy', name: `歌${id}`, singer: '人' } as MusicInfo);
const snapshot = (extra: Partial<Parameters<typeof saveCloudDriveSnapshot>[1]> = {}) => ({
  songs: [song('1'), song('2')],
  count: 2,
  usedBytes: 1024,
  maxBytes: 2048,
  nextOffset: 200,
  hasMore: false,
  ...extra,
});
const saved = () => store.files.get('cloudDrive') as { accounts: Record<string, { cachedAt: number }> };

beforeEach(() => {
  store.files.clear();
  vi.useRealTimers();
});

describe('云盘缓存读写', () => {
  it('写入后能按同一 uid 读回，且算作保鲜', async () => {
    await saveCloudDriveSnapshot('uid-A', snapshot());
    const loaded = await loadCloudDriveSnapshot('uid-A');
    expect(loaded?.fresh).toBe(true);
    expect(loaded?.snapshot.songs.map((item) => item.id)).toEqual(['1', '2']);
    expect(loaded?.snapshot.count).toBe(2);
    expect(loaded?.snapshot.nextOffset).toBe(200);
  });

  it('超过保鲜期仍然读得到，只是标成过期（调用方先显示再刷新）', async () => {
    await saveCloudDriveSnapshot('uid-A', snapshot());
    saved().accounts['uid-A'].cachedAt = Date.now() - CLOUD_DRIVE_CACHE_TTL_MS - 1000;
    const loaded = await loadCloudDriveSnapshot('uid-A');
    expect(loaded?.fresh).toBe(false);
    expect(loaded?.snapshot.songs).toHaveLength(2);
  });

  it('别的账号读不到这份列表', async () => {
    await saveCloudDriveSnapshot('uid-A', snapshot());
    expect(await loadCloudDriveSnapshot('uid-B')).toBeNull();
    expect(await loadCloudDriveSnapshot('')).toBeNull();
  });

  it('空列表与坏结构都不落盘/不生效', async () => {
    await saveCloudDriveSnapshot('uid-A', snapshot({ songs: [] }));
    expect(store.files.get('cloudDrive')).toBeUndefined();

    store.files.set('cloudDrive', { version: 1, accounts: { 'uid-A': { songs: [{ id: 'x' }], cachedAt: Date.now() } } });
    expect(await loadCloudDriveSnapshot('uid-A')).toBeNull();

    store.files.set('cloudDrive', { version: 99, accounts: { 'uid-A': { songs: [song('1')], cachedAt: Date.now() } } });
    expect(await loadCloudDriveSnapshot('uid-A')).toBeNull();
  });

  it('坏掉的行被丢掉，好的行照常返回', async () => {
    store.files.set('cloudDrive', {
      version: 1,
      accounts: {
        'uid-A': { songs: [song('1'), { source: 'wy', id: '' }, null, song('1')], cachedAt: Date.now() },
      },
    });
    const loaded = await loadCloudDriveSnapshot('uid-A');
    expect(loaded?.snapshot.songs.map((item) => item.id)).toEqual(['1']);
  });

  it('退出登录只删这个账号，别的不动', async () => {
    await saveCloudDriveSnapshot('uid-A', snapshot());
    await saveCloudDriveSnapshot('uid-B', snapshot({ songs: [song('B1')] }));
    await clearCloudDriveSnapshot('uid-A');
    expect(await loadCloudDriveSnapshot('uid-A')).toBeNull();
    expect((await loadCloudDriveSnapshot('uid-B'))?.snapshot.songs.map((item) => item.id)).toEqual(['B1']);
  });

  it('最多保留最近三个账号', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    for (const [index, uid] of ['a', 'b', 'c', 'd'].entries()) {
      await saveCloudDriveSnapshot(uid, snapshot({ songs: [song(String(index))] }));
      // 每次把时钟往前拨 1 分钟，写入时间才单调递增，裁剪结果才是确定的
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, index + 1)));
    }
    expect(Object.keys(saved().accounts).sort()).toEqual(['b', 'c', 'd']);
  });
});
