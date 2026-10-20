import { mapLeaderboardBoards, type WyLeaderboardBoard, type WyPlaylistOrder } from "@lx/core";
import type { WyPlaylistInfo } from "./wyPlaylistService";
import { asRecord, getJson, mapPlaylist } from "./wyHomeFeedService";

/**
 * 网易云排行榜 + 歌单广场服务（移动端）。
 *
 * 榜单分组清单、分类清单、TOP3 归一化、播放量格式化都搬去了 `@lx/core`：
 * 桌面端现在有同样的两个页面，这份硬编码清单只能有一份，否则「手机有、桌面没有」
 * 只是时间问题。这里只剩「网易云公开接口」这一层——拉取、分页、错误映射，
 * 以及移动端自己的 `WyPlaylistInfo` 适配。
 *
 * 榜单详情不在这里：榜单就是歌单（`boardToPlaylistInfo` 转出来的 id 可直接进
 * PlaylistDetailScreen），详情由详情页自己拉 `/v3/playlist/detail`。
 */

export {
  WY_BOARD_GROUPS,
  WY_PLAYLIST_CATEGORIES,
  type WyBoardGroup,
  type WyBoardGroupKey,
  type WyPlaylistOrder,
} from "@lx/core";

export type { WyLeaderboardBoard };

/**
 * 拉取全部榜单：内置清单打底，`/api/toplist` 只负责补封面、更新频率与 TOP3 试读。
 * 接口失败时返回只有 id + name 的内置清单，页面用占位色块也能进、也能点。
 */
export async function fetchWyLeaderboardBoards(): Promise<WyLeaderboardBoard[]> {
  try {
    const data = await getJson("/api/toplist");
    return mapLeaderboardBoards(data.list);
  } catch {
    return mapLeaderboardBoards(undefined);
  }
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
