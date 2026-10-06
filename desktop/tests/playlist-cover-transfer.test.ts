import type { MusicInfo } from '@lx/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPlaylists, importPlaylists } from '../src/services/playlistTransferService';
import { usePlaylistStore } from '../src/stores/playlistStore';

const files = vi.hoisted(() => ({ save: vi.fn(), open: vi.fn(), write: vi.fn(), read: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: files.save, open: files.open }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: files.write, readTextFile: files.read }));
vi.mock('@/stores/libraryPersistence', () => ({ attachLibraryPersistence: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  files.save.mockResolvedValue('export.json'); files.open.mockResolvedValue('import.json');
  usePlaylistStore.setState({ playlists: [] });
});

describe('本地歌单独立封面的持久化传递', () => {
  it('导入歌曲与独立封面在同一次store更新中保存', () => {
    const changes: unknown[] = [];
    const unsubscribe = usePlaylistStore.subscribe(state => changes.push(state.playlists));
    const result = usePlaylistStore.getState().importPlaylist('List', undefined, [], 'https://example.com/cover.jpg');
    unsubscribe();
    expect(changes).toHaveLength(1);
    expect(result.cover).toBe('https://example.com/cover.jpg');
    expect(usePlaylistStore.getState().playlists[0].cover).toBe(result.cover);
  });

  it('JSON导出再导入保留独立封面，不丢成无封面歌单', async () => {
    await exportPlaylists([{ id: 'original', name: 'List', songs: [], cover: 'https://example.com/cover.jpg', createdAt: 0, updatedAt: 0 }]);
    const exported = files.write.mock.calls[0][1];
    expect(JSON.parse(exported).playlists[0].cover).toBe('https://example.com/cover.jpg');
    files.read.mockResolvedValue(exported);
    expect(await importPlaylists()).toBe(1);
    expect(usePlaylistStore.getState().playlists[0].cover).toBe('https://example.com/cover.jpg');
  });

  it('旧版不含封面的JSON仍可导入', async () => {
    files.read.mockResolvedValue(JSON.stringify({ app: 'auralflow', version: 1, playlists: [{ name: 'Legacy', songs: [] }] }));
    expect(await importPlaylists()).toBe(1);
    expect(usePlaylistStore.getState().playlists[0].cover).toBeUndefined();
  });

  it('文件里的无效封面类型明确报错，不写入坏数据', async () => {
    files.read.mockResolvedValue(JSON.stringify({ app: 'auralflow', version: 1, playlists: [{ name: 'Bad', songs: [], cover: 123 }] }));
    await expect(importPlaylists()).rejects.toThrow('封面');
    expect(usePlaylistStore.getState().playlists).toEqual([]);
  });
});

it('旧picUrl独立封面导出后归一到cover，优先于歌曲图片', async () => {
  const legacy = { id: 'legacy', name: 'Legacy', picUrl: 'https://example.com/playlist.jpg', songs: [{ id: 'song', source: 'wy', name: 'Song', singer: 'Artist', picUrl: 'https://example.com/song.jpg' } as MusicInfo], createdAt: 0, updatedAt: 0 };
  await exportPlaylists([legacy]);
  const exported = files.write.mock.calls[0][1];
  expect(JSON.parse(exported).playlists[0].cover).toBe(legacy.picUrl);
  files.read.mockResolvedValue(exported);
  await importPlaylists();
  expect(usePlaylistStore.getState().playlists[0].cover).toBe(legacy.picUrl);
});

it('直接导入旧picUrl字段保留独立封面', async () => {
  files.read.mockResolvedValue(JSON.stringify({ app: 'auralflow', playlists: [{ name: 'Legacy', picUrl: 'https://example.com/legacy.jpg', songs: [] }] }));
  await importPlaylists();
  expect(usePlaylistStore.getState().playlists[0].cover).toBe('https://example.com/legacy.jpg');
});

it('无独立封面的歌单导出时不固化歌曲派生图片', async () => {
  await exportPlaylists([{ id: 'derived', name: 'Derived', createdAt: 0, updatedAt: 0, songs: [{ id: 'song', source: 'wy', name: 'Song', singer: 'Artist', img: 'https://example.com/song.jpg' } as MusicInfo] }]);
  expect(JSON.parse(files.write.mock.calls[0][1]).playlists[0]).not.toHaveProperty('cover');
});

it('旧picUrl类型错误同样在写入前拒绝整批导入', async () => {
  files.read.mockResolvedValue(JSON.stringify({ app: 'auralflow', playlists: [{ name: 'Valid', songs: [] }, { name: 'Bad', picUrl: 12, songs: [] }] }));
  await expect(importPlaylists()).rejects.toThrow('封面');
  expect(usePlaylistStore.getState().playlists).toEqual([]);
});
