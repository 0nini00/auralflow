/**
 * 搜索历史管理 — 对齐移动端 searchHistoryService。
 * 使用 localStorage 持久化。
 */

import { dedupeSearchHistory, normalizeSearchKeyword, updateSearchHistory } from '@lx/core';

const STORAGE_KEY = "af-search-history";
const MAX_HISTORY_COUNT = 20;

export function getSearchHistory(): string[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = data ? JSON.parse(data) : [];
    if (!Array.isArray(parsed)) return [];
    return dedupeSearchHistory(parsed.filter((item): item is string => typeof item === 'string'), MAX_HISTORY_COUNT);
  } catch {
    return [];
  }
}

export function addSearchHistory(keyword: string): void {
  const trimmed = normalizeSearchKeyword(keyword);
  if (!trimmed) return;

  const history = getSearchHistory();
  const updated = updateSearchHistory(history, trimmed, MAX_HISTORY_COUNT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function removeSearchHistory(keyword: string): void {
  const history = getSearchHistory();
  const updated = history.filter((item) => item !== normalizeSearchKeyword(keyword));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function clearSearchHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
