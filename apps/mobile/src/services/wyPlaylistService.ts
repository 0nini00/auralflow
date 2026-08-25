import { getWyCookie } from "./wyAccountService";
import type { PlaylistInfo, MusicInfo } from "@lx/core";
import { mapWyTrackToMusicInfo } from "./wyMusicMapper";
import { weapi } from "@/services/weapi";
import { fetchWithTimeout } from "@/utils/fetchWithTimeout";
import {
  buildNeteasePcCookie,
  buildWyPlaylistSubscribeRequest,
} from "./wyPlaylistSubscribeModel";

/**
 * 网易云歌单信息（扩展）
 */
export interface WyPlaylistInfo extends PlaylistInfo {
  coverImgUrl?: string;
  trackCount: number;
  playCount?: number;
  subscribed?: boolean;
  creator?: {
    userId: string;
    nickname: string;
  };
  /** WebDAV 引用的更新时间；在线接口返回的歌单可以不提供。 */
  updatedAt?: number;
}

export interface DailyRecommendResult {
  songs: MusicInfo[];
  hasMore: boolean;
}

export interface PersonalFmResult {
  songs: MusicInfo[];
  hasMore: boolean;
}

const WY_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.54",
};

type JsonRecord = Record<string, any>;

function csrfToken(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)__?csrf=([^;]+)/);
  return match?.[1] ?? "";
}

export async function postWyWeapi<TResponse = JsonRecord>(
  path: string,
  payload: Record<string, any>,
  cookie: string,
): Promise<TResponse> {
  const { params, encSecKey } = await weapi({
    ...payload,
    csrf_token: csrfToken(cookie),
  });
  const response = await fetchWithTimeout(`https://music.163.com/weapi${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://music.163.com",
      Referer: "https://music.163.com",
      Cookie: buildNeteasePcCookie(cookie),
      ...WY_REQUEST_HEADERS,
    },
    body: new URLSearchParams({ params, encSecKey }).toString(),
  });

  const data = (await response.json()) as JsonRecord;
  if (!response.ok) {
    throw new Error(data?.message || `请求失败 HTTP ${response.status}`);
  }
  return data as TResponse;
}


/**
 * 获取用户歌单
 */
export async function getUserPlaylists(userId: string): Promise<WyPlaylistInfo[]> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetchWithTimeout(
      `https://music.163.com/api/user/playlist?uid=${userId}&limit=1000&offset=0`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code === 200 && data.playlist) {
      return data.playlist.map((item: any) => {
        const creatorUserId = item.creator?.userId;
        const creator =
          creatorUserId != null && String(creatorUserId).trim()
            ? {
                userId: String(creatorUserId),
                nickname: String(item.creator?.nickname ?? ""),
              }
            : undefined;

        return {
          id: String(item.id),
          name: item.name,
          author: item.creator?.nickname || "未知",
          picUrl: item.coverImgUrl,
          coverImgUrl: item.coverImgUrl,
          desc: item.description,
          playCount: item.playCount,
          trackCount: item.trackCount || 0,
          source: "wy" as const,
          subscribed: item.subscribed,
          creator,
        };
      });
    }

    throw new Error("获取歌单失败");
  } catch (error) {
    throw error;
  }
}

/**
 * 获取歌单详情（歌曲列表）。
 * 公开歌单免登录可查看（对齐 lx：浏览歌单不要求登录）；
 * 已登录时附带 Cookie，用于解析部分需要登录的歌单。
 */
/** 批量拉取歌曲详情的分块大小（对齐桌面端 fetchSongDetailsInChunks）。 */
const SONG_DETAIL_CHUNK_SIZE = 500;

/** 从歌单详情响应中提取完整 trackIds（v6 接口 tracks 只含前 ~10 首，trackIds 是全集）。 */
function extractWyTrackIds(playlist: JsonRecord): string[] {
  const raw = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
  return raw
    .map((item: any) => (item != null && typeof item === "object" ? item?.id : item))
    .map((id: unknown) => String(id))
    .filter((id) => id && id !== "undefined" && id !== "null");
}

/** 用 /weapi/v3/song/detail 按 id 批量补齐歌曲详情（对齐桌面端/lx 的做法）。 */
async function fetchWySongDetailsInChunks(ids: string[], cookie: string): Promise<unknown[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += SONG_DETAIL_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + SONG_DETAIL_CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const body = await postWyWeapi<JsonRecord>(
        "/v3/song/detail",
        {
          c: JSON.stringify(chunk.map((id) => ({ id: Number(id) }))),
          ids: JSON.stringify(chunk.map((id) => Number(id))),
        },
        cookie,
      );
      return Array.isArray(body.songs) ? body.songs : [];
    }),
  );

  return results.flat();
}

export async function getPlaylistDetail(playlistId: string): Promise<MusicInfo[]> {
  const cookie = await getWyCookie();
  const headers: Record<string, string> = { ...WY_REQUEST_HEADERS };
  if (cookie) headers["Cookie"] = cookie;

  try {
    const response = await fetchWithTimeout(
      `https://music.163.com/api/v6/playlist/detail?id=${playlistId}&n=100000`,
      {
        method: "GET",
        headers,
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code === 200 && data.playlist) {
      const previewTracks = Array.isArray(data.playlist.tracks) ? data.playlist.tracks : [];
      const trackIds = extractWyTrackIds(data.playlist);

      // v6 接口只返回前 ~10 首完整歌曲 + 全部 trackIds，需要按 trackIds 批量补齐（对齐桌面端/lx）
      if (trackIds.length > previewTracks.length) {
        try {
          const fullTracks = await fetchWySongDetailsInChunks(trackIds, cookie ?? "");
          if (fullTracks.length > 0) {
            return fullTracks.map(mapWyTrackToMusicInfo);
          }
        } catch (error) {
          console.warn("补齐网易云歌单歌曲失败，将使用接口返回的歌曲", error);
        }
      }

      return previewTracks.map(mapWyTrackToMusicInfo);
    }

    throw new Error("获取歌单详情失败");
  } catch (error) {
    throw error;
  }
}

/**
 * 喜欢歌曲
 */
export async function likeSong(songId: string): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetchWithTimeout(
      `https://music.163.com/api/radio/like?alg=itembased&trackId=${songId}&like=true&time=3`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code !== 200) {
      throw new Error("喜欢歌曲失败");
    }
  } catch (error) {
    throw error;
  }
}

/**
 * 取消喜欢歌曲
 */
export async function unlikeSong(songId: string): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetchWithTimeout(
      `https://music.163.com/api/radio/like?alg=itembased&trackId=${songId}&like=false&time=3`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code !== 200) {
      throw new Error("取消喜欢失败");
    }
  } catch (error) {
    throw error;
  }
}

export async function subscribePlaylist(playlistId: string, subscribe: boolean): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  const request = buildWyPlaylistSubscribeRequest(playlistId, subscribe);
  const data = await postWyWeapi(request.path, request.payload, cookie);
  if (data.code !== 200) {
    throw new Error(data.message || "网易云歌单收藏失败");
  }
}

async function manipulatePlaylistTracks(
  op: "add" | "del",
  playlistId: string,
  trackIds: string[],
): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  const ids = trackIds.map((id) => String(id)).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("缺少网易云歌曲 ID");
  }

  const buildPayload = (targetIds: string[]) => ({
    op,
    pid: String(playlistId),
    trackIds: JSON.stringify(targetIds),
    imme: "true",
  });

  let data = await postWyWeapi("/playlist/manipulate/tracks", buildPayload(ids), cookie);
  if (op === "add" && data.code === 512) {
    data = await postWyWeapi("/playlist/manipulate/tracks", buildPayload([...ids, ...ids]), cookie);
  }
  if (data.code !== 200 && data.code !== 201) {
    throw new Error(data.message || "网易云歌单歌曲操作失败");
  }
}

export async function addPlaylistTracks(playlistId: string, trackIds: string[]): Promise<void> {
  await manipulatePlaylistTracks("add", playlistId, trackIds);
}

export async function removePlaylistTracks(playlistId: string, trackIds: string[]): Promise<void> {
  await manipulatePlaylistTracks("del", playlistId, trackIds);
}

/**
 * 获取喜欢的音乐列表
 */
export async function getLikedSongs(userId: string): Promise<string[]> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetchWithTimeout(
      `https://music.163.com/api/song/like/get?uid=${userId}`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code === 200 && data.ids) {
      return data.ids.map((id: number) => String(id));
    }

    return [];
  } catch (error) {
    return [];
  }
}

/**
 * 获取每日推荐歌曲
 */
export async function getDailyRecommendSongs(): Promise<DailyRecommendResult> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetchWithTimeout(
      "https://music.163.com/api/v3/discovery/recommend/songs",
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code !== 200) {
      throw new Error(data.message || "获取每日推荐失败");
    }

    const recommend = Array.isArray(data.data?.dailySongs) ? data.data.dailySongs : [];

    return {
      songs: recommend.map(mapWyTrackToMusicInfo),
      hasMore: Boolean(data.data?.hasMore),
    };
  } catch (error) {
    throw error;
  }
}

/** 首页聚合层使用的每日推荐公开签名，复用既有请求实现。 */
export async function fetchDailyRecommendedSongs(): Promise<DailyRecommendResult> {
  return getDailyRecommendSongs();
}

/**
 * 获取私人 FM
 */
export async function getPersonalFmSongs(): Promise<PersonalFmResult> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetchWithTimeout(
      "https://music.163.com/api/radio/get",
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code !== 200) {
      throw new Error(data.message || "获取私人 FM 失败");
    }

    const recommend = Array.isArray(data.data) ? data.data : [];

    return {
      songs: recommend.map(mapWyTrackToMusicInfo),
      hasMore: recommend.length > 0,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * 不喜欢当前 FM 歌曲
 */
export async function trashPersonalFmSong(songId: string): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("未登录");
  }

  try {
    const response = await fetchWithTimeout(
      `https://music.163.com/api/radio/trash/add?alg=RT&songId=${songId}&time=0`,
      {
        method: "GET",
        headers: {
          "Cookie": cookie,
          ...WY_REQUEST_HEADERS,
        },
      }
    );

    const data = (await response.json()) as JsonRecord;

    if (data.code !== 200) {
      throw new Error(data.message || "标记不喜欢失败");
    }
  } catch (error) {
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 网易云歌单新建 / 编辑 / 删除（A4：我的网易云歌单新建、编辑）
// ---------------------------------------------------------------------------

/** 创建歌单。type=0 表示普通歌单，1 为精选。 */
export async function createWyPlaylist(
  name: string,
  options?: { description?: string; type?: number },
): Promise<WyPlaylistInfo> {
  const cookie = await getWyCookie();
  if (!cookie) throw new Error("未登录");
  const data = await postWyWeapi(
    "/playlist/create",
    {
      name,
      desc: options?.description ?? "",
      privacy: 0,
      type: options?.type ?? 0,
    },
    cookie,
  );
  if (data.code !== 200) {
    throw new Error(data.message || "创建歌单失败");
  }
  const playlist = data.playlist ?? data;
  const playlistId = String(playlist.id ?? "");
  const description = options?.description ?? "";
  if (description.trim()) {
    try {
      await updateWyPlaylistInfo(playlistId, { description });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`歌单已创建，但简介更新失败：${message}`);
    }
  }
  return {
    id: playlistId,
    name: String(playlist.name ?? name),
    author: "",
    desc: description.trim() ? description : playlist.description ?? playlist.desc ?? undefined,
    picUrl: playlist.coverImgUrl ?? playlist.picUrl ?? undefined,
    playCount: playlist.playCount ?? 0,
    trackCount: Number(playlist.trackCount ?? 0),
    coverImgUrl: playlist.coverImgUrl ?? undefined,
    source: "wy",
    subscribed: false,
  };
}

/** 编辑歌单名称/简介/封面。传 undefined 的字段保持不变。 */
export async function updateWyPlaylistInfo(
  playlistId: string,
  changes: { name?: string; description?: string; coverImgUrl?: string },
): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) throw new Error("未登录");
  const payload: Record<string, any> = { id: Number(playlistId) };
  if (changes.name !== undefined) payload.name = changes.name;
  if (changes.description !== undefined) payload.desc = changes.description;
  if (changes.coverImgUrl !== undefined) payload.pic = changes.coverImgUrl;
  const data = await postWyWeapi("/playlist/update", payload, cookie);
  if (data.code !== 200) {
    throw new Error(data.message || "编辑歌单失败");
  }
}

/** 删除歌单。 */
export async function deleteWyPlaylist(playlistId: string): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) throw new Error("未登录");
  const data = await postWyWeapi("/playlist/delete", { ids: `[${playlistId}]` }, cookie);
  if (data.code !== 200) {
    throw new Error(data.message || "删除歌单失败");
  }
}

// ---------------------------------------------------------------------------
// 网易云评论（A3：发送评论）
// ---------------------------------------------------------------------------

/** 发送评论。targetType 为 1=歌曲，2=歌单，6=专辑，8=歌手（对应网易云 commentType）。
 * threadId 格式：歌曲 R_SO_4_<id>、歌单 A_PL_0_<id>、专辑 R_AL_3_<id>（对齐 fetchNeteaseComments）。 */
export async function sendWyComment(
  targetId: string | number,
  content: string,
  targetType: 1 | 2 | 6 | 8 = 1,
): Promise<void> {
  const cookie = await getWyCookie();
  if (!cookie) throw new Error("未登录");
  // 网易云评论线程 id：前缀由资源类型决定
  const threadId = buildCommentThreadId(targetId, targetType);
  const data = await postWyWeapi(
    "/resource/comments/add",
    {
      threadId,
      content,
    },
    cookie,
  );
  if (data.code !== 200 && data.code !== 201) {
    throw new Error(data.message || "评论失败");
  }
}

function buildCommentThreadId(targetId: string | number, targetType: 1 | 2 | 6 | 8): string {
  switch (targetType) {
    case 2:
      return `A_PL_0_${targetId}`;
    case 6:
      return `R_AL_3_${targetId}`;
    case 8:
      return `R_ART_0_${targetId}`;
    case 1:
    default:
      return `R_SO_4_${targetId}`;
  }
}
