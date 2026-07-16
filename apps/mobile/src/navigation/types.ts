/**
 * 导航参数类型。
 * 主壳对齐桌面：抽屉 = Sidebar（默认隐藏），顶栏 = Header，底栏 = PlayerBar。
 * 详情页（歌手/专辑/歌单/本地/B站/喜欢）挂在 Root Stack，由 Search/Library 跳转进入。
 */
import type { NavigatorScreenParams } from "@react-navigation/native";
import type { SearchAlbumResult, SearchArtistResult } from "@/services/musicApi";
import type { BiliCollectionInfo } from "@/services/biliService";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import type { SearchFallbackDetailModel } from "@/services/searchFallbackDetailModel";
import type { SearchDetailRoute } from "@/services/searchDetailNavigation";

/** 抽屉内主页面 —— 对齐桌面 Sidebar 路由 */
export type MainDrawerParamList = {
  Home: undefined;
  Search:
    | {
        initialKeyword?: string;
        /** 深链带入的详情跳转目标（艺人/专辑/歌单等），由 SearchScreen 消费后清空 */
        initialDetailRoute?: SearchDetailRoute | null;
      }
    | undefined;
  Daily: undefined;
  FM: undefined;
  /** 歌单（Library 的 playlists 分区） */
  Playlists: undefined;
  /** 本地音乐（Library 的 local 分区） */
  Local: undefined;
  /** 下载管理 */
  Downloads: undefined;
  /** 兼容旧入口：完整曲库（含历史/B站等分区） */
  Library: { section: "history" | "bili" };
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

/** 根 Stack：主壳 + 模态播放 + 内容详情 */
export type RootStackParamList = {
  Main: NavigatorScreenParams<MainDrawerParamList> | undefined;
  Player: undefined;
  ArtistDetail: {
    artist: SearchArtistResult;
  };
  AlbumDetail: {
    album: SearchAlbumResult;
    parentArtist?: SearchArtistResult | null;
  };
  PlaylistDetail: {
    playlist: WyPlaylistInfo;
  };
  LocalPlaylistDetail: {
    playlistId: string;
  };
  BiliCollectionDetail: {
    collection: BiliCollectionInfo;
  };
  LikedSongs: undefined;
  SearchFallbackDetail: {
    detail: SearchFallbackDetailModel;
  };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
