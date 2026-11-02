import {
  fetchDailyRecommendedSongs,
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

async function fetchRecommendedPlaylists(context: HomeFeedContext): Promise<WyPlaylistInfo[]> {
  if (context.isLoggedIn) {
    try {
      const personalized = await getPersonalizedRecommendedPlaylists(SECTION_LIMITS.recommendedPlaylists);
      if (personalized.length > 0) return personalized;
    } catch {
      // Public recommendations remain the module-level fallback.
    }
  }
  // 热门歌单固定前 12 条几乎不变（刷新看不出变化）。
  // 在热门榜前 60 条内随机偏移取一页，让每次下拉刷新都能看到不同的热门歌单子集。
  const offset = Math.floor(Math.random() * 5) * SECTION_LIMITS.recommendedPlaylists;
  return getPublicRecommendedPlaylists(SECTION_LIMITS.recommendedPlaylists, offset);
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
