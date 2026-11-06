import type { MusicInfo } from "@lx/core";
import { isOwnedWyPlaylist, type WyPlaylistOwnership } from "./wyPlaylistOwnership";

export interface PlaylistDetailActionsModel {
  show: boolean;
  playAllLabel: string;
  shuffleLabel: string;
}

export interface PlaylistDetailActionInput {
  source?: string;
}

export type PlaylistDetailRemoveInput = WyPlaylistOwnership;

export function canRemoveSongsFromPlaylistDetail(
  input: PlaylistDetailRemoveInput,
  userId: string | undefined,
): boolean {
  return isOwnedWyPlaylist(input, userId);
}

export function buildPlaylistDetailActions(
  songCount: number,
  input: PlaylistDetailActionInput = {},
): PlaylistDetailActionsModel {
  return {
    show: songCount > 0,
    playAllLabel: "播放全部",
    shuffleLabel: "随机播放",
  };
}

export { shuffleItems as shufflePlaylistSongs } from "@lx/core";

export function findPlaylistCurrentSongIndex(
  songs: MusicInfo[],
  currentSong: MusicInfo | null | undefined,
): number {
  if (!currentSong) return -1;
  return songs.findIndex(
    (song) => song.source === currentSong.source && String(song.id) === String(currentSong.id),
  );
}
