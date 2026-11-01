/**
 * 推荐歌单的「每日一版 + 换一批」编排。
 *
 * 为什么放在 core：双端必须对「今天是哪一批」给出**同一个答案**。各端各自
 * `Math.random()` 会得到两份不同的列表，用户切换设备会以为数据乱了；而种子化
 * 洗牌是纯函数，可以在这里单测，两端只负责喂池子和存历史。
 *
 * 三个关键决定：
 *
 * 1. **种子是「本地日历日 + 当天第几批」**，不是每次请求随机。热门歌单本身几天
 *    都不变，纯随机只会在这堆固定的菜里换摆盘；日期驱动才有"每天新一版"的语义。
 * 2. **洗牌用 FNV-1a + mulberry32**，不依赖 `Math.random`，因此同一种子在任何
 *    宿主机上结果一致（`localeCompare` 之类的区域设置差异也一并避开）。
 * 3. **近期展示过的歌单降权而不是剔除**：池子不够时宁可重复也要凑满一屏，
 *    否则用户会看到"今天只有 3 个歌单"。
 */

/** 近期展示历史的一条记录：只留 id 与它被展示的日期。 */
export interface RecommendationHistoryEntry {
  id: string;
  /** 本地日历日 `YYYY-MM-DD` */
  dateKey: string;
}

export interface RotateRecommendationsOptions {
  limit: number;
  /**
   * 近期已经展示过的歌单 id。它们会被排到洗牌结果的后面，
   * 只有新鲜候选不足 `limit` 时才用来补齐。
   */
  recentIds?: readonly string[];
}

/** 历史里最多保留多少条 id，超出按时间从旧到新丢弃。 */
export const RECOMMENDATION_HISTORY_CAP = 400;
/** 降权窗口：多少天内展示过的歌单算「刚见过」。 */
export const RECOMMENDATION_RECENT_WINDOW_DAYS = 14;

/** 本地日历日（与听歌统计同口径：按宿主本地日分组，不用 UTC）。 */
export function buildRecommendationDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 轮换种子：同一天同一批 → 同一份结果；跨天或换一批 → 另一份。 */
export function buildRecommendationSeed(dateKey: string, batch: number): string {
  const normalizedBatch = Number.isFinite(batch) ? Math.max(0, Math.trunc(batch)) : 0;
  return `${dateKey}#${normalizedBatch}`;
}

/** FNV-1a 32 位哈希：稳定、可复现，且不产生跨端差异。 */
export function hashRecommendationSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32：小而确定的 PRNG，同一种子产出同一序列。 */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** 按种子洗牌（Fisher-Yates），返回新数组，不改动入参。 */
export function shuffleWithRecommendationSeed<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  const random = createSeededRandom(hashRecommendationSeed(seed));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

/**
 * 从候选池里挑出这一批。
 *
 * 顺序：池子按 id 去重 → 种子洗牌 → 近期展示过的全部挪到后面 →
 * 取前 `limit` 条（新鲜候选不够时由「刚见过」的补齐）。
 */
export function rotateRecommendations<T extends { id: string }>(
  pool: readonly T[],
  seed: string,
  options: RotateRecommendationsOptions,
): T[] {
  const limit = Math.max(0, Math.trunc(options.limit));
  if (limit === 0 || pool.length === 0) return [];

  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of pool) {
    const id = String(item.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }
  if (unique.length <= limit) return unique;

  const recent = new Set((options.recentIds ?? []).map((id) => String(id)));
  const shuffled = shuffleWithRecommendationSeed(unique, seed);
  const fresh = shuffled.filter((item) => !recent.has(String(item.id)));
  const stale = shuffled.filter((item) => recent.has(String(item.id)));

  // 新鲜候选够一屏就只给新鲜的；不够才补「刚见过」的，宁可重复也不给半屏。
  return [...fresh, ...stale].slice(0, limit);
}

/** 窗口内（含今天）展示过的 id，按新→旧返回，用于喂给 `rotateRecommendations`。 */
export function pickRecentRecommendationIds(
  history: readonly RecommendationHistoryEntry[],
  todayKey: string,
  windowDays: number = RECOMMENDATION_RECENT_WINDOW_DAYS,
): string[] {
  const today = parseDateKeyToDayNumber(todayKey);
  if (today === null) return [];
  const window = Math.max(0, Math.trunc(windowDays));
  const ids: string[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const day = parseDateKeyToDayNumber(String(entry?.dateKey ?? ""));
    const id = String(entry?.id ?? "").trim();
    if (!id || day === null) continue;
    const ageDays = today - day;
    if (ageDays < 0 || ageDays > window) continue;
    ids.push(id);
  }
  return ids;
}

/** 把日期串（`YYYY-MM-DD`）换算成可比较的天序号，无法解析返回 null。 */
function parseDateKeyToDayNumber(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Date.UTC 会把 2026-99-99 进位数年，所以必须回读核对，而不是只信正则。
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.floor(time / 86_400_000);
}

/**
 * 记下这一批展示过的歌单，返回新的历史。
 *
 * 同一 id 只保留最近一次（避免一个歌单反复出现在历史里把别的挤掉），
 * 并裁掉窗口之外与超出 `cap` 的旧记录。
 */
export function recordRecommendationHistory(
  history: readonly RecommendationHistoryEntry[],
  shownIds: readonly string[],
  dateKey: string,
  options: { cap?: number; windowDays?: number } = {},
): RecommendationHistoryEntry[] {
  const cap = Math.max(1, Math.trunc(options.cap ?? RECOMMENDATION_HISTORY_CAP));
  const windowDays = Math.max(0, Math.trunc(options.windowDays ?? RECOMMENDATION_RECENT_WINDOW_DAYS));
  const today = parseDateKeyToDayNumber(dateKey);
  if (today === null) return [...history];

  const shown = new Set(shownIds.map((id) => String(id).trim()).filter(Boolean));
  const kept = history.filter((entry) => {
    const id = String(entry?.id ?? "").trim();
    if (!id || shown.has(id)) return false;
    const day = parseDateKeyToDayNumber(String(entry?.dateKey ?? ""));
    if (day === null) return false;
    const ageDays = today - day;
    return ageDays >= 0 && ageDays <= windowDays;
  });

  const appended = [...shown].map((id) => ({ id, dateKey }));
  const merged = [...kept, ...appended];
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}
