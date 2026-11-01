import {
  fetchDailyRecommendedSongs,
  type WyPlaylistInfo,
} from "./wyPlaylistService";
import {
  fetchWyRecommendedPlaylistPool,
  getNewAlbums,
  getNewSongs,
  getPersonalizedRecommendedPlaylists,
} from "./wyHomeFeedService";
import { pickRecommendedPlaylistBatch } from "./recommendationRotationService";
import {
  HOME_FEED_REMOTE_SECTION_ORDER,
  HOME_FEED_SECTION_TITLES,
  type HomeFeedContext,
  type HomeFeedError,
  type HomeFeedSection,
  type HomeFeedSectionById,
  type HomeFeedSectionId,
  type HomeSectionItems,
} from "./homeFeedModels";

export type {
  HomeFeedSection,
  HomeFeedSectionById,
  HomeFeedSectionId,
} from "./homeFeedModels";

const SECTION_LIMITS = {
  recommendedPlaylists: 12,
  dailySongs: 12,
  newSongs: 20,
  newAlbums: 12,
} as const;

const EMPTY_SECTION_ITEMS: HomeSectionItems = {
  recommendedPlaylists: [],
  dailySongs: [],
  newSongs: [],
  newAlbums: [],
};

function toFeedError(error: unknown): HomeFeedError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return {
    kind: lower.includes("登录") || lower.includes("cookie") || lower.includes("auth") ? "auth"
      : lower.includes("json") || lower.includes("格式") ? "invalid"
        : lower.includes("网络") || lower.includes("http") || lower.includes("fetch") ? "network" : "unknown",
    message: message || "加载失败",
  };
}

function readySection<K extends HomeFeedSectionId>(
  kind: K,
  items: HomeSectionItems[K],
): HomeFeedSectionById<K> {
  return {
    id: kind,
    kind,
    title: HOME_FEED_SECTION_TITLES[kind],
    status: "ready",
    items,
    error: null,
    updatedAt: Date.now(),
  };
}

function errorSection<K extends HomeFeedSectionId>(
  kind: K,
  error: unknown,
  previous?: HomeFeedSectionById<K>,
): HomeFeedSectionById<K> {
  return {
    id: kind,
    kind,
    title: HOME_FEED_SECTION_TITLES[kind],
    status: "error",
    items: previous?.items ?? EMPTY_SECTION_ITEMS[kind],
    error: toFeedError(error),
    updatedAt: previous?.updatedAt ?? null,
  };
}

/** 候选池缓存：多分类拼接的结果没必要每次刷新都重拉。 */
const RECOMMENDED_POOL_TTL_MS = 6 * 60 * 60 * 1000;
let recommendedPoolCache: { fetchedAt: number; items: WyPlaylistInfo[] } | null = null;
let recommendedPoolInFlight: Promise<WyPlaylistInfo[]> | null = null;

async function getRecommendedPlaylistPool(): Promise<WyPlaylistInfo[]> {
  if (recommendedPoolCache && Date.now() - recommendedPoolCache.fetchedAt < RECOMMENDED_POOL_TTL_MS) {
    return recommendedPoolCache.items;
  }
  if (recommendedPoolInFlight) return recommendedPoolInFlight;
  recommendedPoolInFlight = fetchWyRecommendedPlaylistPool(24)
    .then((items) => {
      recommendedPoolCache = { fetchedAt: Date.now(), items };
      return items;
    })
    .finally(() => {
      recommendedPoolInFlight = null;
    });
  return recommendedPoolInFlight;
}

/**
 * 推荐歌单：登录后优先个性化（一天一变），否则走公开池的「每日一版」轮换。
 *
 * 旧实现是「在热门前 60 条里随机取一页」——热门前 60 条本身几天不变，翻来覆去
 * 就是那几组，所以体感上每次打开都一样。现在改成多分类候选池 + 日期种子的稳定轮换，
 * 编排算法与桌面端共用 `@lx/core` 的实现。
 */
async function fetchRecommendedPlaylists(context: HomeFeedContext): Promise<WyPlaylistInfo[]> {
  if (context.isLoggedIn) {
    try {
      const personalized = await getPersonalizedRecommendedPlaylists(SECTION_LIMITS.recommendedPlaylists);
      if (personalized.length > 0) return personalized;
    } catch {
      // 个性化不可用时回退公开池，未登录与登录失败走同一条路径。
    }
  }
  const pool = await getRecommendedPlaylistPool();
  return pickRecommendedPlaylistBatch(pool, SECTION_LIMITS.recommendedPlaylists);
}

const SECTION_LOADERS: {
  [K in HomeFeedSectionId]: (context: HomeFeedContext) => Promise<HomeSectionItems[K]>;
} = {
  recommendedPlaylists: fetchRecommendedPlaylists,
  dailySongs: async (context) => {
    if (!context.isLoggedIn) return [];
    const result = await fetchDailyRecommendedSongs();
    return result.songs.slice(0, SECTION_LIMITS.dailySongs);
  },
  newSongs: () => getNewSongs(SECTION_LIMITS.newSongs),
  newAlbums: () => getNewAlbums(SECTION_LIMITS.newAlbums),
};

export async function fetchHomeFeedSection<K extends HomeFeedSectionId>(
  id: K,
  context: HomeFeedContext,
): Promise<HomeFeedSectionById<K>> {
  try {
    return readySection(id, await SECTION_LOADERS[id](context));
  } catch (error) {
    return errorSection(id, error);
  }
}

export const fetchHomeSection = fetchHomeFeedSection;

export async function fetchHomeFeed(context: HomeFeedContext): Promise<HomeFeedSection[]> {
  return Promise.all(HOME_FEED_REMOTE_SECTION_ORDER.map(
    (id): Promise<HomeFeedSection> => fetchHomeFeedSection(id, context),
  ));
}

export function mergeHomeSectionResult<K extends HomeFeedSectionId>(
  previous: HomeFeedSectionById<K> | undefined,
  next: HomeFeedSectionById<K>,
): HomeFeedSectionById<K> {
  if (next.status !== "error" || !previous) return next;
  return {
    ...next,
    items: previous.items,
    updatedAt: previous.updatedAt,
  };
}
