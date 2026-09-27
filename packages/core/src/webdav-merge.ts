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

// ---------------------------------------------------------------------------
// userList 条目归类（本地歌单 / 云端歌单引用）
// ---------------------------------------------------------------------------

/** 云端歌单（网易云 / QQ 音乐）的 id 恒为纯数字，可据此识别同步文件里的引用条目。 */
export function isNumericPlaylistId(id: unknown): boolean {
  const value = toTrimmedString(id);
  return value.length > 0 && /^\d+$/.test(value);
}

/**
 * 判定 WebDAV 同步文件 `userList` 里的一条记录是否为**本地歌单**。
 *
 * 背景：移动端会把云端歌单（网易云 / QQ / B站）也写进 `userList`，但只写引用
 * （id + name，`list` 多为空，歌曲按需拉取）。桌面端若照单全收，这些引用就会被
 * 物化成 0 首歌曲的“本地歌单”，随后又被上传回同步文件，污染双端数据。
 *
 * 判定规则（与移动端 `webdavSyncService` 解析分支保持一致）：
 * - 纯数字 id ⇒ 云端歌单（即便是被污染成 `source: "local"` 的条目）；
 * - 显式 `source` 非 `local` ⇒ 云端歌单；
 * - 其余（无 source 的非数字 id / `source: "local"`）⇒ 本地歌单。
 */
export function isWebdavLocalPlaylistRef(entry: { id?: unknown; source?: unknown }): boolean {
  if (isNumericPlaylistId(entry?.id)) return false;
  const source = toTrimmedString(entry?.source).toLowerCase();
  return !source || source === "local";
}

function toTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
