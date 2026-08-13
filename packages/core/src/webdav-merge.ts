/**
 * WebDAV 同步合并算法(纯函数,无副作用,可单测)。
 *
 * 合并规则:
 * 1. 收藏歌曲:本地 + 远端并集,按 source:id 去重
 * 2. 本地歌单:同名 id 按 updatedAt 新者胜,歌曲保留并集
 * 3. 云端引用歌单(网易云等):按 id 并集,保留较新者
 * 4. 播放历史:本地 + 远端并集,按时间倒序截断上限
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
  songs: MusicInfo[];
  createdAt: number;
  updatedAt: number;
}

export interface WdCloudPlaylist {
  id: string;
  name: string;
  source: string;
  description?: string;
  updatedAt: number;
}

export interface WdLocalData {
  favorites: MusicInfo[];
  localPlaylists: WdLocalPlaylist[];
  cloudPlaylists: WdCloudPlaylist[];
  history: MusicInfo[];
}

export interface WdRemoteData {
  favorites: MusicInfo[];
  /** 带歌曲的本地歌单,来自远端 userList */
  remotePlaylists: WdLocalPlaylist[];
  /** 云端引用歌单,来自远端 userList 中 songs 为空的部分 */
  cloudPlaylists: WdCloudPlaylist[];
  history: MusicInfo[];
}

export interface WdMergedData {
  favorites: MusicInfo[];
  localPlaylists: WdLocalPlaylist[];
  cloudPlaylists: WdCloudPlaylist[];
  history: MusicInfo[];
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

const MAX_HISTORY_ITEMS = 200;

function songKey(song: MusicInfo): string {
  return `${song.source}:${song.id}`;
}

function dedupeSongs(songs: MusicInfo[]): MusicInfo[] {
  const seen = new Set<string>();
  const result: MusicInfo[] = [];
  for (const song of songs) {
    const key = songKey(song);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(song);
  }
  return result;
}

/** 两首歌的歌曲并集,保留先出现的(first)中的顺序,合并 second 中未出现的。 */
function mergeSongList(first: MusicInfo[], second: MusicInfo[]): MusicInfo[] {
  const seen = new Set<string>();
  const result: MusicInfo[] = [];

  for (const song of first) {
    const key = songKey(song);
    seen.add(key);
    result.push(song);
  }
  for (const song of second) {
    const key = songKey(song);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(song);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 主合并函数
// ---------------------------------------------------------------------------

export function mergeWebdavData(
  local: WdLocalData,
  remote: WdRemoteData,
): WdMergedData {
  // 1. 收藏歌曲:并集
  const favorites = mergeSongList(local.favorites, remote.favorites);

  // 2. 本地歌单:按 id 合并,同名同 id 取较新者,歌曲并集
  const localPlaylistMap = new Map<string, WdLocalPlaylist>();
  for (const pl of local.localPlaylists) {
    localPlaylistMap.set(pl.id, pl);
  }
  for (const pl of remote.remotePlaylists) {
    const existing = localPlaylistMap.get(pl.id);
    if (!existing) {
      localPlaylistMap.set(pl.id, pl);
    } else if (pl.updatedAt > existing.updatedAt) {
      // 远端更新
      localPlaylistMap.set(pl.id, {
        ...pl,
        songs: mergeSongList(existing.songs, pl.songs),
      });
    } else {
      // 本地更新,保留本地歌曲但吸收远端可能有而本地没有的歌曲
      localPlaylistMap.set(pl.id, {
        ...existing,
        songs: mergeSongList(existing.songs, pl.songs),
      });
    }
  }
  const localPlaylists = Array.from(localPlaylistMap.values());

  // 3. 云端引用歌单:按 id 并集,保留较新者
  const cloudPlaylistMap = new Map<string, WdCloudPlaylist>();
  for (const pl of local.cloudPlaylists) {
    cloudPlaylistMap.set(pl.id, pl);
  }
  for (const pl of remote.cloudPlaylists) {
    const existing = cloudPlaylistMap.get(pl.id);
    if (!existing || pl.updatedAt > existing.updatedAt) {
      cloudPlaylistMap.set(pl.id, pl);
    }
  }
  const cloudPlaylists = Array.from(cloudPlaylistMap.values());

  // 4. 播放历史:并集,按时间倒序(假设 insertedAt 由远端提供/本地按顺序),
  //    上限 200
  const history = dedupeSongs([...local.history, ...remote.history])
    .slice(0, MAX_HISTORY_ITEMS);

  return { favorites, localPlaylists, cloudPlaylists, history };
}

// ---------------------------------------------------------------------------
// 桌面端适配:将桌面端 Playlist 类型映射为 WdLocalPlaylist 再合并
// ---------------------------------------------------------------------------

export interface WdDesktopPlaylist {
  id: string;
  name: string;
  description?: string;
  cover?: string;
  songs: MusicInfo[];
  createdAt: number;
  updatedAt: number;
}

export function mergeWebdavDataDesktop(
  localFavorites: MusicInfo[],
  localPlaylists: WdDesktopPlaylist[],
  localHistory: MusicInfo[],
  remoteFavorites: MusicInfo[],
  remotePlaylists: WdDesktopPlaylist[],
  remoteHistory: MusicInfo[],
): {
  favorites: MusicInfo[];
  playlists: WdDesktopPlaylist[];
  history: MusicInfo[];
} {
  const local: WdLocalData = {
    favorites: localFavorites,
    localPlaylists: localPlaylists.map(toWdLocalPlaylist),
    cloudPlaylists: [],
    history: localHistory,
  };
  const remote: WdRemoteData = {
    favorites: remoteFavorites,
    remotePlaylists: remotePlaylists.map(toWdLocalPlaylist),
    cloudPlaylists: [],
    history: remoteHistory,
  };
  const merged = mergeWebdavData(local, remote);
  return {
    favorites: merged.favorites,
    playlists: merged.localPlaylists.map(toWdDesktopPlaylist),
    history: merged.history,
  };
}

function toWdLocalPlaylist(p: WdDesktopPlaylist): WdLocalPlaylist {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    songs: p.songs,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toWdDesktopPlaylist(p: WdLocalPlaylist): WdDesktopPlaylist {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    songs: p.songs,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}