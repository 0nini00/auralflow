import type { MusicInfo } from "@lx/core";
import type { LocalPlaylist } from "./localPlaylistModel";
import { getLocalPlaylistTrackCount } from "./localPlaylistModel";
import type { WyPlaylistInfo } from "./wyPlaylistService";

export interface LocalPlaylistSongOption {
  id: string;
  name: string;
  trackCount: number;
  containsSong: boolean;
}

export interface WyPlaylistSongOption {
  id: string;
  name: string;
  trackCount: number;
}

function getSongKey(song: Pick<MusicInfo, "source" | "id">): string {
  return `${song.source}:${song.id}`;
}

export function buildLocalPlaylistSongOptions(
  playlists: LocalPlaylist[],
  song: Pick<MusicInfo, "source" | "id">,
): LocalPlaylistSongOption[] {
  const songKey = getSongKey(song);
  return playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    trackCount: getLocalPlaylistTrackCount(playlist),
    containsSong: playlist.songs.some((item) => getSongKey(item) === songKey),
  }));
}

export function getAddToLocalPlaylistEmptyText(options: LocalPlaylistSongOption[]): string | null {
  if (options.length === 0) return "还没有本地歌单，请先在我的音乐中新建";
  if (options.every((option) => option.containsSong)) return "这首歌已在全部本地歌单中";
  return null;
}

export function buildOwnedWyPlaylistSongOptions(
  playlists: WyPlaylistInfo[],
  song: Pick<MusicInfo, "source" | "id">,
): WyPlaylistSongOption[] {
  if (song.source !== "wy") return [];

  return playlists
    .filter((playlist) => playlist.source === "wy" && playlist.subscribed !== true)
    .map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      trackCount: playlist.trackCount ?? 0,
    }));
}

export function getAddToWyPlaylistEmptyText(
  options: WyPlaylistSongOption[],
  song: Pick<MusicInfo, "source" | "id">,
): string | null {
  if (song.source !== "wy") return "仅网易云歌曲可添加到网易云歌单";
  if (options.length === 0) return "暂无网易云自建歌单";
  return null;
}
