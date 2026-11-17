import type { MusicInfo } from "@lx/core";

/** 在详情列表中定位当前播放歌曲下标，找不到返回 -1 */
export function findContentDetailCurrentSongIndex(
  songs: MusicInfo[],
  currentSong: MusicInfo | null | undefined,
): number {
  if (!currentSong) return -1;
  return songs.findIndex(
    (song) => song.source === currentSong.source && String(song.id) === String(currentSong.id),
  );
}
