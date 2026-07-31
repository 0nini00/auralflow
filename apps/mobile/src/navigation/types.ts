import type { NavigatorScreenParams } from "@react-navigation/native";
import type { SearchAlbumResult, SearchArtistResult } from "@/services/musicApi";
import type { BiliCollectionInfo } from "@/services/biliService";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import type { SearchFallbackDetailModel } from "@/services/searchFallbackDetailModel";
import type { SearchDetailRoute } from "@/services/searchDetailNavigation";

/** 底部 4 标签 */
export type MainTabParamList = {
  HomeTab: undefined;
  LibraryTab: undefined;
  MyMusicTab: undefined;
  SearchTab:
    | {
        initialKeyword?: string;
        initialDetailRoute?: SearchDetailRoute | null;
      }
    | undefined;
};

/** 曲库内部 TopTab */
export type LibraryTopTabParamList = {
  Playlists: undefined;
  Bili: undefined;
};

/** 我的内部 TopTab */
export type MyMusicTopTabParamList = {
  Local: undefined;
  History: undefined;
  Downloads: undefined;
};

/** 抽屉（保留但内容精简：账号 + 工具 + 设置） */
export type MainDrawerParamList = {
  MainTabs: undefined;
  Settings: undefined;
};

export type SettingsDrawerParamList = {
  Account: undefined;
  Appearance: undefined;
  Playback: undefined;
  Sources: undefined;
  Lyrics: undefined;
  Sync: undefined;
  Data: undefined;
  About: undefined;
};

export type SettingsStackParamList = {
  Categories: NavigatorScreenParams<SettingsDrawerParamList> | undefined;
  Login: undefined;
  WebDav: undefined;
  CustomSources: undefined;
  LyricDetail: undefined;
};

/** 根 Stack */
export type RootStackParamList = {
  Main: NavigatorScreenParams<MainDrawerParamList> | undefined;
  Player: undefined;
  DailyRecommend: undefined;
  PersonalFm: undefined;
  ArtistDetail: { artist: SearchArtistResult };
  AlbumDetail: { album: SearchAlbumResult; parentArtist?: SearchArtistResult | null };
  PlaylistDetail: { playlist: WyPlaylistInfo };
  LocalPlaylistDetail: { playlistId: string };
  BiliCollectionDetail: { collection: BiliCollectionInfo };
  LikedSongs: undefined;
  SearchFallbackDetail: { detail: SearchFallbackDetailModel };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
