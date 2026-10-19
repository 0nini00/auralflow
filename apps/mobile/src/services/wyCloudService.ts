import { toCloudMusicInfos, type MusicInfo, type WyCloudItem } from "@lx/core";

import { getWyCookie } from "./wyAccountService";
import { postWyWeapi } from "./wyPlaylistService";

/** 云盘一页的返回：可播放条目 + 容量信息（都来自 `/v1/cloud/get` 的同一次响应）。 */
export interface WyCloudSongsPage {
  songs: MusicInfo[];
  /** 云盘内歌曲总数（不是本页条数） */
  count: number;
  /** 已用字节数 */
  usedBytes?: number;
  /** 容量上限字节数 */
  maxBytes?: number;
  /**
   * 下一页的 offset：由**接口原始条数**推进，不能用映射后的 `songs.length`。
   *
   * `toCloudMusicInfos` 会丢掉缺 id / 缺歌名的记录；用映射后长度会把下一页起点
   * 往前挪导致条目重复，而 `count` 仍按原始条数计，翻页会一直停不下来。
   */
  nextOffset: number;
  hasMore: boolean;
}

interface WyCloudResponse {
  data?: WyCloudItem[];
  count?: number;
  size?: number;
  maxSize?: number;
}

/**
 * 拉取音乐云盘一页（对齐桌面端 `services/wyAccountService.getCloudSongs`）。
 *
 * 云盘**不在搜索结果里**：`cloudsearch` 只能命中「被网易云匹配到在线曲目」的条目，
 * 仅自己可见的上传搜不到自己，所以列表只能走这个接口分页。
 *
 * 条目经 `@lx/core` 的 `toCloudMusicInfos` 映射，产出 `source: "wy"` 且带
 * `wyCloud: true` 的 `MusicInfo`——播放链路靠这个标记跳过网关/自定义源与试听判定。
 */
export async function getCloudSongs(
  options: { offset?: number; limit?: number } = {}
): Promise<WyCloudSongsPage> {
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)));

  const cookie = await getWyCookie();
  if (!cookie) throw new Error("未登录网易云账号，无法读取音乐云盘");

  const body = await postWyWeapi<WyCloudResponse>("/v1/cloud/get", { offset, limit }, cookie);

  const items = Array.isArray(body.data) ? body.data : [];
  const songs = toCloudMusicInfos(items);
  const count = Number(body.count ?? songs.length) || songs.length;
  const nextOffset = offset + items.length;

  return {
    songs,
    count,
    usedBytes: Number(body.size ?? 0) || undefined,
    maxBytes: Number(body.maxSize ?? 0) || undefined,
    nextOffset,
    hasMore: nextOffset < count,
  };
}
