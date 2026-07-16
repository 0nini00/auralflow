/**
 * 搜索历史管理 — 对齐移动端 searchHistoryService。
 * 使用 localStorage 持久化。
 */

const STORAGE_KEY = "af-search-history";
const MAX_HISTORY_COUNT = 20;

export function getSearchHistory(): string[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function addSearchHistory(keyword: string): void {
  const trimmed = keyword.trim();
  if (!trimmed) return;

  const history = getSearchHistory();
  const filtered = history.filter((item) => item !== trimmed);
  const updated = [trimmed, ...filtered].slice(0, MAX_HISTORY_COUNT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function removeSearchHistory(keyword: string): void {
  const history = getSearchHistory();
  const updated = history.filter((item) => item !== keyword);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function clearSearchHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
