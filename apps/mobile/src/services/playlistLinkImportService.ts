import { parsePlaylistLink } from "@lx/core";

import { getTxPlaylistDetail, mapTxPlaylistInfo } from "./txPlaylistService";
import { getPlaylistDetail } from "./wyPlaylistService";
import { usePlaylistStore } from "@/stores/playlistStore";

/**
 * 粘贴链接导入歌单：解析网易云/QQ 歌单链接 → 拉取歌曲 → 建为本地歌单。
 * 对齐桌面端 PlaylistsView 的链接导入入口，共用 @lx/core 的链接解析。
 */

export interface PlaylistLinkImportResult {
  source: "wy" | "tx";
  playlistId: string;
  songCount: number;
}

export async function importPlaylistFromLink(input: {
  link: string;
  name: string;
}): Promise<PlaylistLinkImportResult> {
  const parsed = parsePlaylistLink(input.link);
  if (!parsed) {
    throw new Error("无法识别歌单链接，支持网易云 / QQ 音乐歌单链接或纯数字歌单 ID");
  }

  const name = input.name.trim() || "导入的歌单";
  const songs = parsed.source === "wy"
    ? await getPlaylistDetail(parsed.playlistId)
    : await getTxPlaylistDetail(
        mapTxPlaylistInfo({
          id: parsed.playlistId,
          name,
          source: "tx",
        }),
      );

  if (!songs || songs.length === 0) {
    throw new Error("歌单为空或拉取失败，请确认链接后重试");
  }

  await usePlaylistStore.getState().createLocalPlaylistWithSongs({ name, songs });
  return { source: parsed.source, playlistId: parsed.playlistId, songCount: songs.length };
}
