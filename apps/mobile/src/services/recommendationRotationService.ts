import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  buildRecommendationDateKey,
  buildRecommendationSeed,
  pickRecentRecommendationIds,
  recordRecommendationHistory,
  rotateRecommendations,
  type RecommendationHistoryEntry,
} from "@lx/core";

/**
 * 首页「推荐歌单」的轮换状态。
 *
 * 编排算法在 `@lx/core/recommendation-rotation`（与桌面端同一份，保证同一天两端
 * 给出同一批）；这里只负责两件平台相关的事：把「当天第几批」和「展示历史」持久化，
 * 以及在用户点「换一批」时把批次号推到下一批。
 *
 * 历史与批次都不带账号维度：换账号仍沿用同一份去重记录，避免同一台设备上
 * 两个账号来回切时反复看到同一批歌单。
 */
const STORAGE_KEY = "auralflow.mobile.recommendationRotation.v1";
/** 首页推荐歌单区块展示多少个（与 SECTION_LIMITS 保持一致）。 */
export const RECOMMENDED_PLAYLISTS_LIMIT = 10;

interface RotationState {
  dateKey: string;
  batch: number;
  history: RecommendationHistoryEntry[];
}

function emptyState(dateKey: string): RotationState {
  return { dateKey, batch: 0, history: [] };
}

function normalizeHistory(value: unknown): RecommendationHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = entry as Partial<RecommendationHistoryEntry> | null;
      return {
        id: String(record?.id ?? "").trim(),
        dateKey: String(record?.dateKey ?? "").trim(),
      };
    })
    .filter((entry) => entry.id.length > 0 && entry.dateKey.length > 0);
}

async function readState(dateKey: string): Promise<RotationState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState(dateKey);
    const parsed = JSON.parse(raw) as Partial<RotationState> | null;
    const batch = Number(parsed?.batch);
    return {
      dateKey: String(parsed?.dateKey ?? dateKey),
      batch: Number.isFinite(batch) && batch >= 0 ? Math.trunc(batch) : 0,
      history: normalizeHistory(parsed?.history),
    };
  } catch {
    // 存储损坏当作没有历史：宁可重复一次，也不能让首页空掉。
    return emptyState(dateKey);
  }
}

async function writeState(state: RotationState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 写失败只影响去重，不影响展示。
  }
}

/** 取「今天这一批」：同一天同一批稳定，跨天自动换。 */
export async function pickRecommendedPlaylistBatch<T extends { id: string }>(
  pool: readonly T[],
  limit: number = RECOMMENDED_PLAYLISTS_LIMIT,
): Promise<T[]> {
  const dateKey = buildRecommendationDateKey();
  const state = await readState(dateKey);
  const batch = state.dateKey === dateKey ? state.batch : 0;
  const items = rotateRecommendations(pool, buildRecommendationSeed(dateKey, batch), {
    limit,
    recentIds: pickRecentRecommendationIds(state.history, dateKey),
  });
  await writeState({
    dateKey,
    batch,
    history: recordRecommendationHistory(
      state.history,
      items.map((item) => item.id),
      dateKey,
    ),
  });
  return items;
}

/** 「换一批」：把当天批次号推到下一批，随后由调用方重新拉一次该区块。 */
export async function bumpRecommendedPlaylistBatch(): Promise<number> {
  const dateKey = buildRecommendationDateKey();
  const state = await readState(dateKey);
  const nextBatch = (state.dateKey === dateKey ? state.batch : 0) + 1;
  await writeState({ dateKey, batch: nextBatch, history: state.history });
  return nextBatch;
}
