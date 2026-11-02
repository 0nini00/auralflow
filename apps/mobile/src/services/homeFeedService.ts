import {
  fetchDailyRecommendedSongs,
  fetchWyPersonalizedPlaylistMix,
  type WyPlaylistInfo,
} from "./wyPlaylistService";
import {
  getNewAlbums,
  getNewSongs,
  getPersonalizedRecommendedPlaylists,
  getPublicRecommendedPlaylists,
} from "./wyHomeFeedService";
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

/**
 * 推荐歌单：优先 `personalized/playlist`（服务端给一批，客户端不洗牌），
 * 其次「每日推荐歌单」，最后回退公开的「最新歌单」。
 *
 * 旧实现是「热门前 60 条里随机取一页」——热门排序几天不变，5 页翻来覆去就是那几组，
 * 所以体感上每次打开都一样；而且在榜单里洗牌本来也不等于推荐。
 *
 * 与桌面端对齐的实测结论（`hasTaste` 两端都是 false）：这个接口返回的是服务端
 * 轮换的推荐池，**每次请求会换一批**，所以「同一天两端看到的歌单不同」属于正常现象，
 * 不是哪一端掉到了公开兜底。（回退分支真的触发时，`homeFeedStore` 会把该分区标成
 * error 并在首页给出重试入口，不会静默换源。）
 */
async function fetchRecommendedPlaylists(context: HomeFeedContext): Promise<WyPlaylistInfo[]> {
  if (context.isLoggedIn) {
    try {
      const mix = await fetchWyPersonalizedPlaylistMix(SECTION_LIMITS.recommendedPlaylists);
      if (mix.length > 0) return mix;
    } catch {
      // 继续尝试下一个来源
    }
    try {
      const daily = await getPersonalizedRecommendedPlaylists(SECTION_LIMITS.recommendedPlaylists);
      if (daily.length > 0) return daily;
    } catch {
      // 回退公开列表
    }
  }
  // 公开兜底按「最新」排序，不取随机偏移：新歌单持续产生，这一页天然会变。
  return getPublicRecommendedPlaylists(SECTION_LIMITS.recommendedPlaylists, 0);
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
