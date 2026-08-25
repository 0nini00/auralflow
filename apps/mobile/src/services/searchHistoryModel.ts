/** 归一化搜索关键词：去零宽/控制字符、NFC 规范化、两端 trim。
 *  避免剪贴板粘贴/搜索建议带入的不可见字符导致"看起来相同"的关键词去重失败、
 *  历史里出现两条肉眼一样的记录。 */
export function normalizeSearchKeyword(keyword: string): string {
  return keyword
    // 零宽字符、BOM、不换行空格等不可见字符（JS trim 不处理零宽）
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .normalize("NFC")
    .trim();
}

export function updateSearchHistory(
  history: readonly string[],
  keyword: string,
  limit = 10,
): string[] {
  const trimmed = normalizeSearchKeyword(keyword);
  // 先把存量条目一并归一化，清理旧版本写入的脏数据（含零宽/带空格的重复项）
  const normalized = history
    .map((item) => normalizeSearchKeyword(item))
    .filter(Boolean);
  if (!trimmed) return normalized.slice(0, Math.max(0, limit));

  const filtered = normalized.filter((item) => item !== trimmed);
  return [trimmed, ...filtered].slice(0, Math.max(0, limit));
}

/** 读取时对存量历史去重+归一化，自愈旧版本遗留的重复/脏条目。 */
export function dedupeSearchHistory(history: readonly string[], limit = 10): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of history) {
    const item = normalizeSearchKeyword(raw);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}
