import type { MusicInfo } from "@lx/core";

const DEFAULT_LOCATE_HEADER_OFFSET = 260;
const DEFAULT_LOCATE_ROW_HEIGHT = 84;

export interface ContentDetailPlaybackActionsModel {
  show: boolean;
  playAllLabel: string;
  shuffleLabel: string;
  locateLabel: string;
  canLocateCurrentSong: boolean;
  /** 歌曲分区标题（专辑=歌曲，歌手=热门歌曲） */
  songSectionTitle: string;
  emptySongsText: string;
}

export interface ContentDetailPlaybackActionsInput {
  currentSongIndex?: number;
  /** 覆盖默认「播放全部」，如歌手页用「播放热门」 */
  playAllLabel?: string;
  songSectionTitle?: string;
  emptySongsText?: string;
}

export function buildContentDetailPlaybackActions(
  songCount: number,
  input: ContentDetailPlaybackActionsInput = {},
): ContentDetailPlaybackActionsModel {
  return {
    show: songCount > 0,
    playAllLabel: input.playAllLabel ?? "播放全部",
    shuffleLabel: "随机播放",
    locateLabel: "定位当前播放",
    canLocateCurrentSong: input.currentSongIndex != null && input.currentSongIndex >= 0,
    songSectionTitle: input.songSectionTitle ?? "歌曲",
    emptySongsText: input.emptySongsText ?? "暂无歌曲",
  };
}

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

export function shuffleContentDetailSongs(
  songs: MusicInfo[],
  random: () => number = Math.random,
): MusicInfo[] {
  const next = [...songs];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export interface ContentDetailLocateScrollOptions {
  headerOffset?: number;
  rowHeight?: number;
}

export function getContentDetailLocateScrollOffset(
  index: number,
  options: ContentDetailLocateScrollOptions = {},
): number {
  const headerOffset = options.headerOffset ?? DEFAULT_LOCATE_HEADER_OFFSET;
  const rowHeight = options.rowHeight ?? DEFAULT_LOCATE_ROW_HEIGHT;
  return headerOffset + Math.max(0, index) * rowHeight;
}
