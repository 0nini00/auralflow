/**
 * 发现页 / 排行榜页共用的网易云公开数据。
 *
 * 单独开一个 store 而不是各页自己 useState，有两个具体理由：
 *
 * 1. 发现页与排行榜页请求的是同一份榜单清单。各页各拉一次，切页就是两次 /api/toplist，
 *    弱网下还会出现「发现页有封面、排行榜页没有」的不一致。
 * 2. 首页排行榜区块要的是「首个官方榜的前 10 首」，那是一次 100 首的详情请求。用户
 *    在首页与排行榜页之间来回切时，这份数据应当还在（10 分钟 TTL），不然每切一次就
 *    白拉一次整榜。
 *
 * 所有数据都与账号无关：未登录用户进发现页也必须看到内容。因此榜单部分不读 Cookie、
 * 不监听账号变化，也就没有「切账号竞态」这类问题需要防；**唯一的例外是登录后的
 * 个性化推荐**（`推荐歌单` 区块），它失败时静默回退公开池，同样不会让发现页空掉。
 *
 * 推荐歌单的编排在 `@lx/core/recommendation-rotation`：种子化的「每日一版」，
 * 保证双端同一天给出同一批，历史去重则靠这里持久化的一份展示记录。
 */
import { create } from "zustand";
import type { MusicInfo, PlaylistInfo, WyLeaderboardBoard } from "@lx/core";
import {
  buildRecommendationDateKey,
  buildRecommendationSeed,
  pickRecentRecommendationIds,
  recordRecommendationHistory,
  rotateRecommendations,
  type RecommendationHistoryEntry,
} from "@lx/core";
import {
  fetchWyLeaderboardBoards,
  fetchWyPersonalizedRecommendedPlaylists,
  fetchWyRecommendedPlaylistPool,
} from "@/services/wyDiscoverService";
import { getWyCookie } from "@/services/wyAccountService";
import { getSource } from "@/services/sources/sourceService";

/** 缓存有效期。榜单一天内变不了多少；推荐歌单候选池更大、更稳，单独用 6 小时。 */
export const DISCOVER_FEED_TTL_MS = 10 * 60 * 1000;
/** 候选池的缓存时长：池子由多分类拼成，没必要每次进首页都重拉。 */
export const RECOMMENDED_POOL_TTL_MS = 6 * 60 * 60 * 1000;
/** 发现页排行榜区块展示的试读首数。 */
const PREVIEW_LIMIT = 10;
const RECOMMENDED_LIMIT = 12;
/** 轮换状态（当天第几批 + 展示历史）的存储键。 */
const ROTATION_STORAGE_KEY = "af-recommended-rotation-v1";

type SectionStatus = "idle" | "loading" | "ready" | "error";

interface RotationState {
  /** 这批属于哪一天；跨天时批次号归零。 */
  dateKey: string;
  /** 当天第几批：0 是「今日一版」，每次「换一批」+1。 */
  batch: number;
  history: RecommendationHistoryEntry[];
}

interface DiscoverFeedState {
  recommended: PlaylistInfo[];
  recommendedStatus: SectionStatus;
  recommendedError: string;
  /** 当前展示的是当天第几批，供 UI 显示「第 N 批」。 */
  recommendedBatch: number;
  /** 这批是登录后的个性化结果（一天一变），还是公开池的每日轮换（可换一批）。 */
  recommendedSource: "public" | "personalized";

  boards: WyLeaderboardBoard[];
  boardsStatus: SectionStatus;
  boardsError: string;
  /** `/api/toplist` 失败时为 true：榜单仍可点，但没有封面与 TOP3。 */
  boardsDegraded: boolean;

  previewBoardId: string;
  previewBoardName: string;
  previewSongs: MusicInfo[];
  previewStatus: SectionStatus;
  previewError: string;

  fetchedAt: number;
  load: (options?: { force?: boolean }) => Promise<void>;
  /** 「换一批」：从同一份候选池里取当天下一批，不重新联网（池子过期才拉）。 */
  rotateRecommended: () => Promise<void>;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error ?? "").trim();
  return text || fallback;
}

// ── 候选池缓存（模块级，不进 store：它不该触发任何渲染） ──
let poolCache: { fetchedAt: number; items: PlaylistInfo[] } | null = null;
let poolInFlight: Promise<PlaylistInfo[]> | null = null;

/** 丢弃候选池缓存：`load({ force: true })` 与测试重试都靠它真正重拉。 */
export function invalidateRecommendedPool(): void {
  poolCache = null;
}

async function getRecommendedPool(): Promise<PlaylistInfo[]> {
  const fresh = poolCache && Date.now() - poolCache.fetchedAt < RECOMMENDED_POOL_TTL_MS;
  if (fresh) return poolCache!.items;
  if (poolInFlight) return poolInFlight;
  poolInFlight = fetchWyRecommendedPlaylistPool()
    .then((items) => {
      poolCache = { fetchedAt: Date.now(), items };
      return items;
    })
    .finally(() => {
      poolInFlight = null;
    });
  return poolInFlight;
}

function emptyRotationState(dateKey: string): RotationState {
  return { dateKey, batch: 0, history: [] };
}

function readRotationState(dateKey: string): RotationState {
  try {
    const raw = window.localStorage.getItem(ROTATION_STORAGE_KEY);
    if (!raw) return emptyRotationState(dateKey);
    const parsed = JSON.parse(raw) as Partial<RotationState> | null;
    const batch = Number(parsed?.batch);
    const history = Array.isArray(parsed?.history) ? parsed!.history : [];
    const entries = history
      .map((entry) => ({
        id: String((entry as RecommendationHistoryEntry)?.id ?? "").trim(),
        dateKey: String((entry as RecommendationHistoryEntry)?.dateKey ?? "").trim(),
      }))
      .filter((entry) => entry.id.length > 0 && entry.dateKey.length > 0);
    return {
      dateKey: String(parsed?.dateKey ?? dateKey),
      batch: Number.isFinite(batch) && batch >= 0 ? Math.trunc(batch) : 0,
      history: entries,
    };
  } catch {
    // 存储损坏不该让首页变空：当作没有历史，重新开始轮换。
    return emptyRotationState(dateKey);
  }
}

function writeRotationState(state: RotationState): void {
  try {
    window.localStorage.setItem(ROTATION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额满：静默降级为「不做去重」，不影响展示。
  }
}

/** 从池子里挑出「某天第 N 批」，并把结果记进展示历史。 */
function pickRecommendedBatch(
  pool: PlaylistInfo[],
  dateKey: string,
  batch: number,
  history: RecommendationHistoryEntry[],
): { items: PlaylistInfo[]; state: RotationState } {
  const recentIds = pickRecentRecommendationIds(history, dateKey);
  const items = rotateRecommendations(pool, buildRecommendationSeed(dateKey, batch), {
    limit: RECOMMENDED_LIMIT,
    recentIds,
  });
  return {
    items,
    state: {
      dateKey,
      batch,
      history: recordRecommendationHistory(
        history,
        items.map((item) => item.id),
        dateKey,
      ),
    },
  };
}

export const useDiscoverFeedStore = create<DiscoverFeedState>((set, get) => {
  // 同一次刷新只发一轮请求：并发调用（发现页与排行榜页同时挂载）共享同一个 Promise。
  let inFlight: Promise<void> | null = null;
  // 代次：强制刷新会让上一轮的结果作废，避免旧响应覆盖新数据。
  let generation = 0;

  const loadPreview = async (board: WyLeaderboardBoard, requestGeneration: number) => {
    set({ previewBoardId: board.id, previewBoardName: board.name });
    const provider = getSource("wy");
    if (!provider?.getPlaylistDetail) {
      set({ previewStatus: "error", previewError: "未找到网易云音源", previewSongs: [] });
      return;
    }
    try {
      const songs = await provider.getPlaylistDetail({
        id: board.id,
        name: board.name,
        author: "网易云音乐",
        source: "wy",
      });
      if (requestGeneration !== generation) return;
      set({
        previewSongs: songs.slice(0, PREVIEW_LIMIT),
        previewStatus: songs.length > 0 ? "ready" : "error",
        previewError: songs.length > 0 ? "" : "这个榜单没有返回歌曲",
      });
    } catch (error) {
      if (requestGeneration !== generation) return;
      set({
        previewSongs: [],
        previewStatus: "error",
        previewError: errorText(error, "榜单试读加载失败"),
      });
    }
  };

  /**
   * 推荐歌单：登录后优先个性化（一天一变），否则走公开池的每日轮换。
   * 两者都失败时交给上层显示错误，不会静默给空。
   */
  const loadRecommended = async (): Promise<PlaylistInfo[]> => {
    try {
      const personalized = await fetchWyPersonalizedRecommendedPlaylists(
        await getWyCookie(),
        RECOMMENDED_LIMIT,
      );
      if (personalized.length > 0) {
        set({ recommendedBatch: 0, recommendedSource: "personalized" });
        return personalized;
      }
    } catch {
      // 未登录 / 接口失败：继续走公开池，默认路径不因登录态而变空。
    }
    const pool = await getRecommendedPool();
    const dateKey = buildRecommendationDateKey();
    const rotation = readRotationState(dateKey);
    // 跨天时批次号归零；历史仍然要用（降权窗口是 14 天，跨天的重复也该避开）。
    const batch = rotation.dateKey === dateKey ? rotation.batch : 0;
    const picked = pickRecommendedBatch(pool, dateKey, batch, rotation.history);
    writeRotationState(picked.state);
    set({ recommendedBatch: batch, recommendedSource: "public" });
    return picked.items;
  };

  const run = async () => {
    const requestGeneration = ++generation;
    set({
      recommendedStatus: "loading",
      recommendedError: "",
      boardsStatus: "loading",
      boardsError: "",
      previewStatus: "loading",
      previewError: "",
    });

    const [recommendedResult, boardsResult] = await Promise.allSettled([
      loadRecommended(),
      fetchWyLeaderboardBoards(),
    ]);
    if (requestGeneration !== generation) return;

    if (recommendedResult.status === "fulfilled") {
      set({
        recommended: recommendedResult.value,
        recommendedStatus: recommendedResult.value.length > 0 ? "ready" : "error",
        recommendedError: recommendedResult.value.length > 0 ? "" : "推荐歌单为空",
      });
    } else {
      set({
        recommended: [],
        recommendedStatus: "error",
        recommendedError: errorText(recommendedResult.reason, "推荐歌单加载失败"),
      });
    }

    const boards = boardsResult.status === "fulfilled"
      ? boardsResult.value.boards
      : [];
    if (boardsResult.status === "fulfilled") {
      set({
        boards,
        boardsDegraded: boardsResult.value.degraded,
        boardsStatus: "ready",
        boardsError: "",
      });
    } else {
      set({
        boards: [],
        boardsStatus: "error",
        boardsError: errorText(boardsResult.reason, "排行榜加载失败"),
      });
    }

    // 试读固定取首个官方榜（飙升榜）：它是「现在在火什么」最直接的一列。
    const firstOfficial = boards.find((board) => board.group === "official");
    if (firstOfficial) {
      await loadPreview(firstOfficial, requestGeneration);
    } else if (requestGeneration === generation) {
      set({ previewSongs: [], previewStatus: "idle", previewError: "" });
    }

    if (requestGeneration === generation) set({ fetchedAt: Date.now() });
  };

  return {
    recommended: [],
    recommendedStatus: "idle",
    recommendedError: "",
    recommendedBatch: 0,
    recommendedSource: "public",
    boards: [],
    boardsStatus: "idle",
    boardsError: "",
    boardsDegraded: false,
    previewBoardId: "",
    previewBoardName: "",
    previewSongs: [],
    previewStatus: "idle",
    previewError: "",
    fetchedAt: 0,

    load: async (options) => {
      const force = options?.force === true;
      // 用户点「重试」时池子也要重拉：失败往往发生在拉池子这一步，缓存住就永远重试不动。
      if (force) invalidateRecommendedPool();
      const { fetchedAt, recommendedStatus, boardsStatus } = get();
      const fresh = Date.now() - fetchedAt < DISCOVER_FEED_TTL_MS;
      if (!force && fresh && recommendedStatus !== "error" && boardsStatus !== "error") return;
      if (inFlight) return inFlight;
      inFlight = run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    rotateRecommended: async () => {
      const dateKey = buildRecommendationDateKey();
      const rotation = readRotationState(dateKey);
      const baseBatch = rotation.dateKey === dateKey ? rotation.batch : 0;
      const pool = await getRecommendedPool();
      const picked = pickRecommendedBatch(pool, dateKey, baseBatch + 1, rotation.history);
      writeRotationState(picked.state);
      set({
        recommended: picked.items,
        recommendedStatus: picked.items.length > 0 ? "ready" : "error",
        recommendedError: picked.items.length > 0 ? "" : "推荐歌单为空",
        recommendedBatch: picked.state.batch,
        recommendedSource: "public",
      });
    },
  };
});
