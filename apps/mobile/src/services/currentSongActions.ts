import type { MusicInfo } from "@lx/core";

export interface CurrentSongActionsModel {
  show: boolean;
  likeLabel: string;
  shareLabel: string;
  addToPlaylistLabel: string;
}

export function buildCurrentSongActions(
  currentSong: MusicInfo | null,
  isLiked: boolean,
): CurrentSongActionsModel {
  return {
    show: currentSong != null,
    likeLabel: isLiked ? "已喜欢" : "喜欢",
    shareLabel: "分享歌曲",
    addToPlaylistLabel: "加入歌单",
  };
}

export function buildPersonalFmSongActions(
  currentSong: MusicInfo | null,
  isLiked: boolean,
): CurrentSongActionsModel {
  return buildCurrentSongActions(currentSong, isLiked);
}

export function buildImmersiveCurrentSongActions(
  currentSong: MusicInfo | null,
  isLiked: boolean,
): CurrentSongActionsModel {
  return buildCurrentSongActions(currentSong, isLiked);
}
