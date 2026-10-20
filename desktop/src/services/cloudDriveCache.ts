import type { MusicInfo } from "@lx/core";
import { libraryLoad, librarySave } from "@lx/tauri-bridge";

/**
 * 云盘列表的落盘缓存。
 *
 * 为什么需要：云盘列表原本只在内存里（store），App 一关就没了，下次启动必然重新拉一遍——
 * 这正是「每次打开都要重新获取」剩下的那半。列表本身是账号私有数据，写盘必须满足三条：
 *
 * 1. **按 uid 分区**：一个账号一条记录，读的时候再校验 uid，绝不让 A 的列表出现在 B 的界面上。
 * 2. **带保鲜期**：过期不等于没用——先显示旧列表，同时后台刷新（见 cloudDriveStore）。
 * 3. **退出登录就删**：把缓存留在磁盘上比多拉一次请求更糟。
 *
 * 与 `dailyRecommendCache` 同一套落盘通道（`library/<namespace>.json`），但**不进 WebDAV 同步**：
 * 它是缓存，不是用户数据，跨设备同步没有意义还会放大冲突面。
 */

const NAMESPACE = "cloudDrive";
/** 保鲜期：10 分钟内直接信任缓存，不发起请求。过期则「先显示旧数据 + 后台刷新」。 */
export const CLOUD_DRIVE_CACHE_TTL_MS = 10 * 60 * 1000;
/** 最多保留几个账号的列表：正常用户 1 个，来回切账号也不会把文件无限撑大。 */
const MAX_ACCOUNTS = 3;

export interface CloudDriveSnapshot {
  songs: MusicInfo[];
  count: number;
  usedBytes?: number;
  maxBytes?: number;
  nextOffset: number;
  hasMore: boolean;
  /** 写入时刻（毫秒时间戳），用于判断保鲜期。 */
  cachedAt: number;
}

interface CacheState {
  version: 1;
  accounts: Record<string, CloudDriveSnapshot>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isMusicInfo(value: unknown): value is MusicInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value.source === "string" && value.source.trim().length > 0 &&
    typeof value.id === "string" && value.id.trim().length > 0 &&
    typeof value.name === "string" && value.name.trim().length > 0
  );
}

/** 只保留结构合法的条目并按 `source:id` 去重：坏一行不该让整份缓存作废，也不该让列表出现重复键。 */
export function normalizeCloudDriveSongs(value: unknown): MusicInfo[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const songs: MusicInfo[] = [];
  for (const item of value) {
    if (!isMusicInfo(item)) continue;
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(item);
  }
  return songs;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeSnapshot(value: unknown): CloudDriveSnapshot | null {
  if (!isRecord(value)) return null;
  const songs = normalizeCloudDriveSongs(value.songs);
  const cachedAt = finiteNumber(value.cachedAt);
  if (songs.length === 0 || cachedAt === undefined) return null;
  return {
    songs,
    count: finiteNumber(value.count) ?? songs.length,
    usedBytes: finiteNumber(value.usedBytes),
    maxBytes: finiteNumber(value.maxBytes),
    nextOffset: finiteNumber(value.nextOffset) ?? songs.length,
    hasMore: value.hasMore === true,
    cachedAt,
  };
}

function normalizeCache(value: unknown): CacheState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.accounts)) {
    return { version: 1, accounts: {} };
  }
  const accounts: Record<string, CloudDriveSnapshot> = {};
  for (const [uid, snapshot] of Object.entries(value.accounts)) {
    if (!uid) continue;
    const normalized = normalizeSnapshot(snapshot);
    if (normalized) accounts[uid] = normalized;
  }
  return { version: 1, accounts };
}

/** 只保留最近的几个账号：按 `cachedAt` 倒序裁剪，避免旧账号永久占位。 */
function pruneAccounts(cache: CacheState): CacheState {
  const entries = Object.entries(cache.accounts)
    .sort((left, right) => right[1].cachedAt - left[1].cachedAt)
    .slice(0, MAX_ACCOUNTS);
  return { version: 1, accounts: Object.fromEntries(entries) };
}

/**
 * 读取某个账号的缓存。
 *
 * `fresh` 为 true 表示还在保鲜期内，调用方可以直接用、不必发请求；false 表示过期，
 * 应当先把旧列表显示出来再后台刷新（而不是清空等新数据）。
 */
export async function loadCloudDriveSnapshot(
  uid: string,
): Promise<{ snapshot: CloudDriveSnapshot; fresh: boolean } | null> {
  if (!uid) return null;
  let state: unknown;
  try {
    state = await libraryLoad(NAMESPACE);
  } catch {
    // 读盘失败等同于「没有缓存」：这里只是加速层，不能因此影响云盘能否打开。
    return null;
  }
  const snapshot = normalizeCache(state).accounts[uid];
  if (!snapshot) return null;
  return { snapshot, fresh: Date.now() - snapshot.cachedAt < CLOUD_DRIVE_CACHE_TTL_MS };
}

export async function saveCloudDriveSnapshot(
  uid: string,
  snapshot: Omit<CloudDriveSnapshot, "cachedAt">,
): Promise<void> {
  if (!uid) return;
  const songs = normalizeCloudDriveSongs(snapshot.songs);
  if (songs.length === 0) return; // 空列表不值得落盘：它既省不下什么，还会把「真的空」固化成缓存
  const cache = normalizeCache(await libraryLoad(NAMESPACE));
  cache.accounts[uid] = { ...snapshot, songs, cachedAt: Date.now() };
  // 先插入再裁剪：如果先裁后插，第 4 个账号会一直留在表里（裁剪时它还没进表）。
  await librarySave(NAMESPACE, pruneAccounts(cache));
}

/** 退出登录 / 换账号时清掉这个账号的缓存：把云盘内容留在磁盘上比多拉一次请求更糟。 */
export async function clearCloudDriveSnapshot(uid: string): Promise<void> {
  if (!uid) return;
  const cache = normalizeCache(await libraryLoad(NAMESPACE));
  if (!cache.accounts[uid]) return;
  delete cache.accounts[uid];
  await librarySave(NAMESPACE, cache);
}
