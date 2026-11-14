// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scrubSyncedCloudPlaylists, type Playlist } from '../src/stores/playlistStore';

/**
 * 「先备份再丢弃」里的备份是硬前置：localStorage 写失败（配额、被禁用）时
 * 不能再把歌单丢掉——那等于无备份销毁用户数据。备份失败应当放弃本次清理，
 * 留到下次读盘/合并再试。
 */
vi.mock('@lx/tauri-bridge', () => ({ libraryLoad: vi.fn(async () => null), librarySave: vi.fn(async () => {}) }));

const cloudRef: Playlist = {
  id: '123456',
  name: '被误物化的云端歌单',
  songs: [],
  createdAt: 1,
  updatedAt: 1,
};
const localPlaylist: Playlist = {
  id: 'playlist_1',
  name: '本地歌单',
  songs: [{ id: 'a', source: 'wy', name: '歌', singer: '手' } as Playlist['songs'][number]],
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('云端引用清洗的备份前置', () => {
  it('备份写入成功：剔除云端引用并留下备份', () => {
    const result = scrubSyncedCloudPlaylists([cloudRef, localPlaylist]);
    expect(result).toEqual([localPlaylist]);
    const backup = localStorage.getItem('auralflow:library:playlists:scrub-backup');
    expect(backup).toContain('被误物化的云端歌单');
  });

  it('备份写入失败：放弃本次剔除，原样保留', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const result = scrubSyncedCloudPlaylists([cloudRef, localPlaylist]);
    expect(result).toEqual([cloudRef, localPlaylist]);
  });
});
