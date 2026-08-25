import type { MusicInfo } from "@lx/core";
import { libraryLoad, librarySave } from "@lx/tauri-bridge";

const MAX_DAILY_HISTORY = 15;
const DAILY_NAMESPACE = "dailyRecommend";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface DailyRecommendSnapshot {
  date: string;
  songs: MusicInfo[];
  cachedAt: number;
}

interface DailyRecommendCacheState {
  version: 1;
  accounts: Record<string, DailyRecommendSnapshot[]>;
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

export function normalizeDailySongs(value: unknown): MusicInfo[] {
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

export function normalizeDailyRecommendHistory(value: unknown): DailyRecommendSnapshot[] {
  if (!Array.isArray(value)) return [];

  const snapshots = value
    .map((item): DailyRecommendSnapshot | null => {
      if (!isRecord(item) || typeof item.date !== "string" || !DATE_PATTERN.test(item.date)) return null;
      const songs = normalizeDailySongs(item.songs);
      if (songs.length === 0) return null;
      return {
        date: item.date,
        songs,
        cachedAt: Number.isFinite(item.cachedAt) ? Number(item.cachedAt) : 0,
      };
    })
    .filter((item): item is DailyRecommendSnapshot => item !== null)
    .sort((left, right) => right.date.localeCompare(left.date) || right.cachedAt - left.cachedAt);

  const dates = new Set<string>();
  return snapshots
    .filter((snapshot) => {
      if (dates.has(snapshot.date)) return false;
      dates.add(snapshot.date);
      return true;
    })
    .slice(0, MAX_DAILY_HISTORY);
}

function normalizeCache(value: unknown): DailyRecommendCacheState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.accounts)) {
    return { version: 1, accounts: {} };
  }

  const accounts: Record<string, DailyRecommendSnapshot[]> = {};
  for (const [uid, history] of Object.entries(value.accounts)) {
    const normalized = normalizeDailyRecommendHistory(history);
    if (uid && normalized.length > 0) accounts[uid] = normalized;
  }
  return { version: 1, accounts };
}

export async function loadDailyRecommendHistory(uid: string): Promise<DailyRecommendSnapshot[]> {
  if (!uid) return [];
  const cache = normalizeCache(await libraryLoad(DAILY_NAMESPACE));
  return cache.accounts[uid] ?? [];
}

export async function saveDailyRecommendSnapshot(
  uid: string,
  snapshot: DailyRecommendSnapshot,
): Promise<DailyRecommendSnapshot[]> {
  if (!uid) return [];
  const cache = normalizeCache(await libraryLoad(DAILY_NAMESPACE));
  const history = normalizeDailyRecommendHistory([
    snapshot,
    ...(cache.accounts[uid] ?? []),
  ]);
  cache.accounts[uid] = history;
  await librarySave(DAILY_NAMESPACE, cache);
  return history;
}
