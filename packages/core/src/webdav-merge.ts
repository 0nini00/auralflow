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

export interface PlaylistScrubResult<T> {
  /** 保留的条目（顺序不变） */
  kept: T[];
  /** 剔除的云端歌单引用（调用方负责备份后再丢弃） */
  dropped: T[];
  /** 疑似污染但含歌曲、被保守保留的条目（调用方只告警，不删） */
  suspicious: T[];
}

/**
 * 清理被误物化成「本地歌单」的云端歌单引用。
 *
 * 历史成因：旧版移动端的归类是 `source === "local" ⇒ 本地`（不看 id），而旧版桌面端又把
 * 云端歌单引用以 `source: "local"` + 纯数字 id 上传，于是这些引用被物化进本地歌单并落盘。
 * 归类守卫（`isWebdavLocalPlaylistRef`）修好之后**只挡住新的**：已落盘的那批没有任何清理
 * 路径 —— 读盘原样读回，合并又「不丢本地独有项」，于是永久留存并每次同步再传回云端，
 * 与桌面端的清洗形成乒乓。这个函数就是那道缺失的清理，两端共用同一套规则。
 *
 * 规则：
 * - `isWebdavLocalPlaylistRef` 判为本地 ⇒ 保留；
 * - 否则（纯数字 id = 云端歌单特征）：**0 首** ⇒ 剔除；**有歌曲** ⇒ 保留并标为 `suspicious`，
 *   因为那可能是用户真在用的歌单，删掉就是静默销毁用户数据。
 *
 * 纯函数：不备份、不打日志 —— 那是平台侧的事（桌面端写 localStorage，移动端写 AsyncStorage）。
 */
export function scrubSyncedCloudPlaylistRefs<
  T extends { id?: unknown; source?: unknown; songs?: unknown[] },
>(
  playlists: readonly (T | null | undefined)[] | null | undefined,
): PlaylistScrubResult<T> {
  const kept: T[] = [];
  const dropped: T[] = [];
  const suspicious: T[] = [];

  if (!Array.isArray(playlists) || playlists.length === 0) {
    return { kept, dropped, suspicious };
  }

  for (const playlist of playlists) {
    if (!playlist) continue;
    if (isWebdavLocalPlaylistRef(playlist)) {
      kept.push(playlist);
      continue;
    }
    if ((playlist.songs?.length ?? 0) > 0) {
      suspicious.push(playlist);
      kept.push(playlist);
      continue;
    }
    dropped.push(playlist);
  }

  return { kept, dropped, suspicious };
}

function toTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
