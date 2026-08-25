import {
  createNavigationContainerRef,
  StackActions,
} from "@react-navigation/native";
import type { BiliCollectionInfo } from "@/services/biliService";
import type { SearchAlbumResult, SearchArtistResult } from "@/services/musicApi";
import type { SearchFallbackDetailModel } from "@/services/searchFallbackDetailModel";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import type { SettingsCategoryName } from "./settingsRouteModel";
import { nextSettingsCategoryNavId } from "./settingsRouteModel";
import type {
  LibraryTopTabParamList,
  MainDrawerParamList,
  RootStackParamList,
} from "./types";

export const navigationRef = createNavigationContainerRef<MainDrawerParamList>();

/**
 * 导航到根抽屉（Main 分支 = RootStack）的页面。抽屉在根层级，
 * 一切内容页都从抽屉的 Main 分支进入，因此始终能保证抽屉可用。
 */
export function navigateRoot<Name extends keyof MainDrawerParamList>(
  name: Name,
  params?: MainDrawerParamList[Name],
) {
  if (!navigationRef.isReady()) return;
  // @ts-expect-error react-navigation overload for optional params
  navigationRef.navigate(name, params);
}

/** 导航到 Main 栈（RootStack）内的页面。 */
function navigateStackScreen<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name],
) {
  if (!navigationRef.isReady()) return;
  navigateRoot("Main", {
    screen: name,
    params: params as never,
  });
}

/**
 * 根抽屉 Main 分支栈内 push 语义导航。详情页间链式跳转（如 专辑 → 歌手 → 专辑）
 * 必须用 push：navigate 在目标 screen 已存在于栈中时会“回退到旧实例并更新参数”，
 * 导致返回键直接跳回更早的页面。push 总是压入新实例，返回逐层回退。
 */
export function pushRoot<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name],
) {
  if (!navigationRef.isReady()) return;
  // 根容器是抽屉，push 需要定向派发给 Main 分支的栈导航器
  const rootState = navigationRef.getRootState();
  const mainRoute = rootState.routes.find((route) => route.name === "Main");
  const stackKey = mainRoute?.state?.key;
  if (stackKey) {
    navigationRef.dispatch({
      ...StackActions.push(name, params as never),
      target: stackKey,
    });
    return;
  }
  navigateStackScreen(name, params);
}

export function openPlayerScreen() {
  navigateStackScreen("Player");
}

export function openSearchScreen() {
  navigateRoot("Main", {
    screen: "MainTabs",
    params: { screen: "SearchTab" },
  });
}

export function openLibrarySection(section: keyof LibraryTopTabParamList) {
  navigateRoot("Main", {
    screen: "MainTabs",
    params: { screen: "LibraryTab", params: { screen: section } },
  });
}

export function openHistoryScreen() {
  openLibrarySection("History");
}

export function openDownloadsScreen() {
  openLibrarySection("Downloads");
}

export function openSettingsScreen(category?: SettingsCategoryName) {
  navigateRoot("Settings", {
    screen: category ?? "SettingsHome",
    navId: nextSettingsCategoryNavId(),
  });
}

export function openMvPlayerScreen(params: RootStackParamList["MvPlayer"]) {
  navigateStackScreen("MvPlayer", params);
}

export function openArtistDetailScreen(artist: SearchArtistResult) {
  pushRoot("ArtistDetail", { artist });
}

export function openAlbumDetailScreen(
  album: SearchAlbumResult,
  parentArtist: SearchArtistResult | null = null,
) {
  pushRoot("AlbumDetail", { album, parentArtist });
}

export function openPlaylistDetailScreen(playlist: WyPlaylistInfo) {
  pushRoot("PlaylistDetail", { playlist });
}

export function openLocalPlaylistDetailScreen(playlistId: string) {
  pushRoot("LocalPlaylistDetail", { playlistId });
}

export function openBiliCollectionDetailScreen(collection: BiliCollectionInfo) {
  pushRoot("BiliCollectionDetail", { collection });
}

export function openLikedSongsScreen() {
  navigateStackScreen("LikedSongs");
}

export function openSearchFallbackDetailScreen(detail: SearchFallbackDetailModel) {
  pushRoot("SearchFallbackDetail", { detail });
}

export function openDailyRecommendScreen() {
  navigateStackScreen("DailyRecommend");
}

export function openLeaderboardScreen() {
  pushRoot("Leaderboard");
}

export function openPlaylistSquareScreen() {
  pushRoot("PlaylistSquare");
}

export function openPersonalFmScreen() {
  navigateStackScreen("PersonalFm");
}
