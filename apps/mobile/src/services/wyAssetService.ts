import type { MusicInfo } from "@lx/core";
import { getWyCookie } from "./wyAccountService";
import { postWyWeapi } from "./wyPlaylistService";
import { mapWyTrackToMusicInfo } from "./wyMusicMapper";

type JsonRecord = Record<string, any>;

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
