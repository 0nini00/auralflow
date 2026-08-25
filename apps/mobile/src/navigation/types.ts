import type { NavigatorScreenParams } from "@react-navigation/native";
import type { SearchAlbumResult, SearchArtistResult } from "@/services/musicApi";
import type { BiliCollectionInfo } from "@/services/biliService";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import type { SearchFallbackDetailModel } from "@/services/searchFallbackDetailModel";
import type { SearchDetailRoute } from "@/services/searchDetailNavigation";

/** 底部 4 标签 */
export type MainTabParamList = {
  HomeTab: undefined;
  SearchTab:
    | {
        initialKeyword?: string;
        initialDetailRoute?: SearchDetailRoute | null;
      }
    | undefined;
  LibraryTab: NavigatorScreenParams<LibraryTopTabParamList> | undefined;
  MyMusicTab: undefined;
};

/** 曲库内部 TopTab —— 收敛为来源型：本地音乐 / 播放历史 / 下载 / B站合集 */
export type LibraryTopTabParamList = {
  Local: undefined;
  History: undefined;
  Downloads: undefined;
  Bili: undefined;
};

/**
 * 根抽屉：包住全部内容页（主页 Tab + 内容详情 + 全屏播放器 + 设置）。
 * 抽屉在根层级渲染，推入页（歌单详情等）也能直接打开侧边栏。
 */
export type MainDrawerParamList = {
  Main: NavigatorScreenParams<RootStackParamList> | undefined;
  /**
   * navId：抽屉每次点击分类时递增，SettingsStack 用它重新触发定位跳转。
   * 否则 params.screen 不变（重复点同一分类）时 gate 不再跳转。
   */
  Settings:
    | (NavigatorScreenParams<SettingsStackParamList> & { navId?: number })
    | undefined;
};

export type SettingsStackParamList = {
  SettingsHome: undefined;
  Account: undefined;
  Playback: undefined;
  Lyrics: undefined;
  Appearance: undefined;
  Sources: undefined;
  Sync: undefined;
  Data: undefined;
  About: undefined;
};

/** 根 Stack：主页 Tab + 内容详情 + 全屏播放器（作为抽屉 Main 分支） */
export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Player: undefined;
  MvPlayer: { mvId: string; title: string; artist: string; posterUrl?: string };
  DailyRecommend: undefined;
  PersonalFm: undefined;
  ArtistDetail: { artist: SearchArtistResult };
  AlbumDetail: { album: SearchAlbumResult; parentArtist?: SearchArtistResult | null };
  PlaylistDetail: { playlist: WyPlaylistInfo };
  LocalPlaylistDetail: { playlistId: string };
  BiliCollectionDetail: { collection: BiliCollectionInfo };
  LikedSongs: undefined;
  SearchFallbackDetail: { detail: SearchFallbackDetailModel };
  Leaderboard: undefined;
  PlaylistSquare: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends MainDrawerParamList {}
  }
}
