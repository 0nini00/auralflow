import type { NavigatorScreenParams } from "@react-navigation/native";
import type { SearchAlbumResult, SearchArtistResult } from "@/services/musicApi";
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
  LibraryTab: undefined;
  MyMusicTab: undefined;
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

/**
 * 根 Stack：主页 Tab + 内容详情 + 全屏播放器 + 设置。
 *
 * 2026-10 重构：删除 Drawer。设置从「我的」push 进入，返回即回「我的」，
 * 不再需要「先关抽屉再回主界面」的双重状态。
 */
export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Player: undefined;
  Settings: undefined;
  MvPlayer: { mvId: string; title: string; artist: string; posterUrl?: string };
  DailyRecommend: undefined;
  CloudDrive: undefined;
  PersonalFm: undefined;
  ArtistDetail: { artist: SearchArtistResult };
  AlbumDetail: { album: SearchAlbumResult; parentArtist?: SearchArtistResult | null };
  PlaylistDetail: { playlist: WyPlaylistInfo };
  LocalPlaylistDetail: { playlistId: string };
  LikedSongs: undefined;
  SearchFallbackDetail: { detail: SearchFallbackDetailModel };
  Leaderboard: undefined;
  PlaylistSquare: undefined;
  SimilarSongs: { songId: string; songName: string };
  ListeningStats: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
