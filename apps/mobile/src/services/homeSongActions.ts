import type { MusicInfo } from "@lx/core";

const RECENT_PREVIEW_LIMIT = 10;

export interface HomeSongActionsModel {
  title: string;
  songs: MusicInfo[];
  playAllSongs: MusicInfo[];
  showPlayAll: boolean;
  playAllLabel: string;
  /** 预览被截断时，显示「查看全部」入口 */
  showViewAll: boolean;
  viewAllLabel: string;
  emptyText: string;
  emptyCaption: string;
}

export function buildHomeSongActions(history: MusicInfo[]): HomeSongActionsModel {
  const hasHistory = history.length > 0;
  const preview = history.slice(0, RECENT_PREVIEW_LIMIT);

  return {
    title: "最近播放",
    songs: preview,
    playAllSongs: history,
    showPlayAll: hasHistory,
    playAllLabel: "播放全部",
    showViewAll: history.length > RECENT_PREVIEW_LIMIT,
    viewAllLabel: "查看全部",
    emptyText: "还没有播放过歌曲",
    emptyCaption: "搜索并播放一些音乐后，这里会显示你的最近播放。",
  };
}
