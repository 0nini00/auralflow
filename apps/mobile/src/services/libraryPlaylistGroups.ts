import type { WyPlaylistInfo } from "./wyPlaylistService";

export interface WyPlaylistGroup {
  key: "owned" | "collected";
  title: string;
  count: number;
  playlists: WyPlaylistInfo[];
  emptyText: string;
}

export function buildWyPlaylistGroups(playlists: WyPlaylistInfo[]): WyPlaylistGroup[] {
  const owned = playlists.filter((playlist) => playlist.subscribed !== true);
  const collected = playlists.filter((playlist) => playlist.subscribed === true);

  return [
    {
      key: "owned",
      title: "网易云自建歌单",
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
