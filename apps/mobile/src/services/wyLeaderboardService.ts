import type { WyPlaylistInfo } from "./wyPlaylistService";
import {
  asRecord,
  getJson,
  mapPlaylist,
  type JsonRecord,
} from "./wyHomeFeedService";

/**
 * 网易云排行榜 + 歌单广场服务。
 *
 * 榜单清单内置（对齐 lx leaderboard.js 的 bangid），保证不依赖接口也能展示；
 * `/api/toplist` 用于补充封面与更新频率（已验证可用，含 coverImgUrl 字段）。
 * 榜单详情直接复用 PlaylistDetailScreen：榜单本质是歌单，id 可直接用于
 * `/api/v6/playlist/detail?id=`（PlaylistDetailScreen 内部自行拉取歌曲）。
 */

export type WyBoardGroupKey = "official" | "language" | "genre" | "scene";

export interface WyBoardGroup {
  key: WyBoardGroupKey;
  title: string;
  boards: { id: string; name: string }[];
}

export interface WyLeaderboardBoard {
  id: string;
  name: string;
  group: WyBoardGroupKey;
  coverUrl?: string;
  updateFrequency?: string;
}

/** 内置榜单分组（对齐 lx leaderboard.js）。id 即网易云歌单 id。 */
export const WY_BOARD_GROUPS: readonly WyBoardGroup[] = [
  {
    key: "official",
    title: "官方榜",
    boards: [
      { id: "19723756", name: "飙升榜" },
      { id: "3779629", name: "新歌榜" },
      { id: "2884035", name: "原创榜" },
      { id: "3778678", name: "热歌榜" },
    ],
  },
  {
    key: "language",
    title: "语种榜",
    boards: [
      { id: "5059644681", name: "日语榜" },
      { id: "745956260", name: "韩语榜" },
      { id: "5059642708", name: "国风榜" },
      { id: "6732051320", name: "俄语榜" },
      { id: "7095271308", name: "泰语榜" },
      { id: "6732014811", name: "越南语榜" },
      { id: "60198", name: "美国 Billboard 榜" },
      { id: "180106", name: "UK 排行榜" },
      { id: "60131", name: "日本 Oricon 榜" },
      { id: "27135204", name: "法国 NRJ 周榜" },
    ],
  },
  {
    key: "genre",
    title: "流派榜",
    boards: [
      { id: "991319590", name: "说唱榜" },
      { id: "71384707", name: "古典榜" },
      { id: "1978921795", name: "电音榜" },
      { id: "71385702", name: "ACG 榜" },
      { id: "5059633707", name: "摇滚榜" },
      { id: "5059661515", name: "民谣榜" },
      { id: "10520166", name: "国电榜" },
      { id: "21845217", name: "KTV 唛榜" },
    ],
  },
  {
    key: "scene",
    title: "场景榜",
    boards: [
      { id: "6723173524", name: "网络热歌榜" },
      { id: "5338990334", name: "潜力爆款榜" },
      { id: "6688069460", name: "听歌识曲榜" },
      { id: "5453912201", name: "黑胶 VIP 爱听榜" },
      { id: "7785123708", name: "黑胶 VIP 新歌榜" },
      { id: "7785066739", name: "黑胶 VIP 热歌榜" },
    ],
  },
];

/**
 * 拉取全部榜单（内置清单 + `/api/toplist` 补充封面/更新频率/真实 id）。
 * toplist 失败时回退到内置清单（无封面，页面用占位色块展示）。
 */
export async function fetchWyLeaderboardBoards(): Promise<WyLeaderboardBoard[]> {
  let remoteById = new Map<string, JsonRecord>();
  try {
    const data = await getJson("/api/toplist");
    if (Array.isArray(data.list)) {
      const next = new Map<string, JsonRecord>();
      data.list.forEach((item) => {
        const record = asRecord(item);
        if (record && record.id != null) next.set(String(record.id), record);
      });
      remoteById = next;
    }
  } catch {
    // 接口失败时以内置清单兜底，不影响页面可用性。
  }

  return WY_BOARD_GROUPS.flatMap((group) =>
    group.boards.map((board) => {
      const meta = remoteById.get(board.id);
      return {
        id: board.id,
        name: board.name,
        group: group.key,
        coverUrl: typeof meta?.coverImgUrl === "string"
          ? meta.coverImgUrl
          : typeof meta?.picUrl === "string" ? meta.picUrl : undefined,
        updateFrequency: typeof meta?.updateFrequency === "string"
          ? meta.updateFrequency
          : undefined,
      };
    }),
  );
}

/** 榜单 → WyPlaylistInfo，直接复用 PlaylistDetailScreen。 */
export function boardToPlaylistInfo(board: WyLeaderboardBoard): WyPlaylistInfo {
  return {
    id: board.id,
    name: board.name,
    author: "网易云音乐",
    coverImgUrl: board.coverUrl,
    picUrl: board.coverUrl,
    trackCount: 100,
    source: "wy",
  };
}

/**
 * 歌单广场分类清单。
 * 网易云 `/api/playlist/catlist` 分类接口已下线（404），故内置常用分类，
 * 与 lx 桌面端「推荐歌单」的分类口径一致。
 */
export const WY_PLAYLIST_CATEGORIES = [
  "全部",
  "华语",
  "欧美",
  "日语",
  "韩语",
  "粤语",
  "摇滚",
  "民谣",
  "电子",
  "影视",
  "说唱",
  "国风",
  "轻音乐",
  "ACG",
  "怀旧",
  "网络歌曲",
] as const;

export type WyPlaylistOrder = "hot" | "new";

export interface WyPlaylistPage {
  playlists: WyPlaylistInfo[];
  hasMore: boolean;
}

/**
 * 按分类拉取歌单（热门/最新）。
 * order=hot 为热门歌单（稳定），order=new 为最新歌单（刷新可见变化）。
 */
export async function fetchWyPlaylistsByCategory(
  cat: string,
  order: WyPlaylistOrder,
  limit = 20,
  offset = 0,
): Promise<WyPlaylistPage> {
  const params = new URLSearchParams({
    cat,
    order,
    limit: String(Math.max(1, Math.min(Math.floor(limit), 50))),
    offset: String(Math.max(0, Math.floor(offset))),
  });
  const data = await getJson(`/api/playlist/list?${params.toString()}`);
  if (!Array.isArray(data.playlists)) {
    throw new Error("网易云歌单列表字段缺失");
  }
  const playlists = data.playlists.map((item) => mapPlaylist(asRecord(item) ?? {}));
  return { playlists, hasMore: playlists.length === limit };
}
