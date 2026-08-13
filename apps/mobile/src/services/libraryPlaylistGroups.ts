import type { WyPlaylistInfo } from "./wyPlaylistService";

export interface WyPlaylistGroup {
  key: "owned" | "collected";
  title: string;
  count: number;
  playlists: WyPlaylistInfo[];
  emptyText: string;
}

export function buildWyPlaylistGroups(
  playlists: WyPlaylistInfo[],
  userId: string | undefined,
  likedPlaylistId: string | undefined,
): WyPlaylistGroup[] {
  const owned = userId
    ? playlists.filter(
        (playlist) =>
          playlist.id !== likedPlaylistId &&
          playlist.subscribed !== true &&
          playlist.creator?.userId === userId,
      )
    : [];
  const collected = playlists.filter((playlist) => playlist.subscribed === true);

  return [
    {
      key: "owned",
      title: "创建的歌单",
      count: owned.length,
      playlists: owned,
      emptyText: "还没有网易云自建歌单",
    },
    {
      key: "collected",
      title: "收藏的歌单",
      count: collected.length,
      playlists: collected,
      emptyText: "还没有收藏的网易云歌单",
    },
  ];
}
