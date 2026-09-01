/**
 * WebDAV 同步合并算法(纯函数,无副作用,可单测)。
 *
 * 合并规则:
 * 1. 收藏歌曲:本地 + 远端并集,按 source:id 去重
 * 2. 本地歌单:同名 id 按 updatedAt 新者胜,歌曲保留并集
 * 3. 云端引用歌单(网易云等):按 id 并集,保留较新者
 * 4. 播放历史:本地 + 远端并集,按输入顺序截断上限
 * —— 不同步删除:本地有而远端无的实体保留本地版本
 */

import type { MusicInfo } from "./sources/types";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface WdLocalPlaylist {
  id: string;
  name: string;
  description?: string;
  cover?: string;
  songs: MusicInfo[];
  createdAt: number;
  updatedAt: number;
}

export interface WdCloudPlaylist {
  id: string;
  name: string;
  source: string;
  description?: string;
  updatedAt?: number;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

const MAX_HISTORY_ITEMS = 200;

function songKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

/** 歌曲并集，保留 first 的顺序，并追加 second 中未出现的歌曲。 */
export function mergeWebdavSongs(first: MusicInfo[], second: MusicInfo[]): MusicInfo[] {
  const seen = new Set<string>();
  const result: MusicInfo[] = [];

  for (const song of [...first, ...second]) {
    const key = songKey(song);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(song);
  }
  return result;
}

/** 本地歌单按 id 合并；较新的元数据胜出，时间相等时稳定保留本地版本。 */
export function mergeWebdavLocalPlaylists<T extends WdLocalPlaylist>(
  local: T[],
  remote: T[],
): T[] {
  const playlists = new Map<string, T>();
  for (const playlist of local) playlists.set(playlist.id, playlist);

  for (const remotePlaylist of remote) {
    const localPlaylist = playlists.get(remotePlaylist.id);
    if (!localPlaylist) {
      playlists.set(remotePlaylist.id, remotePlaylist);
      continue;
    }

    const songs = mergeWebdavSongs(localPlaylist.songs, remotePlaylist.songs);
    playlists.set(
      remotePlaylist.id,
      remotePlaylist.updatedAt > localPlaylist.updatedAt
        ? { ...remotePlaylist, songs }
        : { ...localPlaylist, songs },
    );
  }
  return Array.from(playlists.values());
}

function hasComparableTimestamp(value: { updatedAt?: number }): value is { updatedAt: number } {
  return Number.isFinite(value.updatedAt);
}

/** 云端引用按 id 合并；仅在两侧时间可比较且远端更新时替换本地版本。 */
export function mergeWebdavCloudPlaylists<T extends { id: string; updatedAt?: number }>(
  local: T[],
  remote: T[],
): T[] {
  const playlists = new Map<string, T>();
  for (const playlist of local) playlists.set(playlist.id, playlist);

  for (const remotePlaylist of remote) {
    const localPlaylist = playlists.get(remotePlaylist.id);
    if (!localPlaylist) {
      playlists.set(remotePlaylist.id, remotePlaylist);
      continue;
    }
    if (
      hasComparableTimestamp(localPlaylist)
      && hasComparableTimestamp(remotePlaylist)
      && remotePlaylist.updatedAt > localPlaylist.updatedAt
    ) {
      playlists.set(remotePlaylist.id, remotePlaylist);
    }
  }
  return Array.from(playlists.values());
}

/** 播放历史按歌曲去重，保留本地优先顺序并截断上限。 */
export function mergeWebdavHistory(
  local: MusicInfo[],
  remote: MusicInfo[],
  limit = MAX_HISTORY_ITEMS,
): MusicInfo[] {
  return mergeWebdavSongs(local, remote).slice(0, limit);
}
