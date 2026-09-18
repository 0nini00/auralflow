import type { MusicInfo } from "@lx/core";
import { getWyCookie } from "./wyAccountService";
import { postWyWeapi } from "./wyPlaylistService";
import { mapWyTrackToMusicInfo } from "./wyMusicMapper";
import type { SearchAlbumResult, SearchArtistResult } from "./musicApi";

type JsonRecord = Record<string, any>;

/**
 * 获取当前登录网易云账号关注的歌手列表
 */
export async function getFollowedArtists(
  limit = 100,
  offset = 0,
): Promise<{ artists: SearchArtistResult[]; hasMore: boolean; count: number }> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("请先登录网易云音乐账号");
  }

  const data = await postWyWeapi<JsonRecord>(
    "/artist/sublist",
    {
      limit,
      offset,
      total: true,
    },
    cookie,
  );

  if (data.code !== 200) {
    throw new Error(String(data.message || `获取关注歌手失败 (code=${data.code})`));
  }

  const rawList = Array.isArray(data.data) ? data.data : [];
  const artists: SearchArtistResult[] = rawList.map((item: any) => ({
    id: String(item.id),
    name: item.name || "未知歌手",
    avatarUrl: item.picUrl || item.img1v1Url,
    alias: Array.isArray(item.alias) ? item.alias : [],
    source: "wy" as const,
    songCount: typeof item.musicSize === "number" ? item.musicSize : undefined,
  }));

  const count = typeof data.count === "number" ? data.count : artists.length;
  const hasMore = Boolean(data.hasMore ?? (offset + artists.length < count));

  return { artists, hasMore, count };
}

/**
 * 获取当前登录网易云账号收藏的专辑列表
 */
export async function getSubscribedAlbums(
  limit = 100,
  offset = 0,
): Promise<{ albums: SearchAlbumResult[]; hasMore: boolean; count: number }> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("请先登录网易云音乐账号");
  }

  const data = await postWyWeapi<JsonRecord>(
    "/album/sublist",
    {
      limit,
      offset,
      total: true,
    },
    cookie,
  );

  if (data.code !== 200) {
    throw new Error(String(data.message || `获取收藏专辑失败 (code=${data.code})`));
  }

  const rawList = Array.isArray(data.data) ? data.data : [];
  const albums: SearchAlbumResult[] = rawList.map((item: any) => {
    const artistName =
      item.artists?.[0]?.name ||
      item.artist?.name ||
      (Array.isArray(item.artists) ? item.artists.map((a: any) => a.name).join(" / ") : "未知歌手");

    return {
      id: String(item.id),
      name: item.name || "未知专辑",
      artistName,
      coverUrl: item.picUrl,
      trackCount: typeof item.size === "number" ? item.size : undefined,
      source: "wy" as const,
    };
  });

  const count = typeof data.count === "number" ? data.count : albums.length;
  const hasMore = Boolean(data.hasMore ?? (offset + albums.length < count));

  return { albums, hasMore, count };
}

/**
 * 获取网易云某首歌曲的相似推荐歌曲
 */
export async function getSimilarSongs(
  songId: string,
  limit = 50,
  offset = 0,
): Promise<MusicInfo[]> {
  const cookie = await getWyCookie();
  if (!cookie) {
    throw new Error("请先登录网易云音乐账号");
  }

  const data = await postWyWeapi<JsonRecord>(
    "/v1/discovery/simiSong",
    {
      songid: songId,
      limit,
      offset,
    },
    cookie,
  );

  if (data.code !== 200) {
    throw new Error(String(data.message || `获取相似歌曲失败 (code=${data.code})`));
  }

  const rawSongs = Array.isArray(data.songs) ? data.songs : [];
  return rawSongs.map(mapWyTrackToMusicInfo).filter((song) => Boolean(song.id));
}
