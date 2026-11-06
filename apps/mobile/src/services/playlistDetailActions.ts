import type { MusicInfo } from "@lx/core";

export interface PlaylistDetailActionsModel {
  show: boolean;
  playAllLabel: string;
  shuffleLabel: string;
}

export interface PlaylistDetailActionInput {
  source?: string;
}

export interface PlaylistDetailRemoveInput {
  source?: string;
  subscribed?: boolean;
}

export function canRemoveSongsFromPlaylistDetail(input: PlaylistDetailRemoveInput): boolean {
  return input.source === "wy" && input.subscribed === false;
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
