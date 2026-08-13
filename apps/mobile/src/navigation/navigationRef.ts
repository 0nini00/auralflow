import {
  createNavigationContainerRef,
  StackActions,
} from "@react-navigation/native";
import type { BiliCollectionInfo } from "@/services/biliService";
import type { SearchAlbumResult, SearchArtistResult } from "@/services/musicApi";
import type { SearchFallbackDetailModel } from "@/services/searchFallbackDetailModel";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import type { SettingsCategoryName } from "./settingsRouteModel";
import type {
  LibraryTopTabParamList,
  RootStackParamList,
} from "./types";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateRoot<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name],
) {
  if (!navigationRef.isReady()) return;
  // @ts-expect-error react-navigation overload for optional params
  navigationRef.navigate(name, params);
}

/**
 * 根栈 push 语义导航。详情页间链式跳转（如 专辑 → 歌手 → 专辑）必须用 push：
 * navigate 在目标 screen 已存在于栈中时会“回退到旧实例并更新参数”，
 * 导致返回键直接跳回更早的页面（AlbumDetail(A)→ArtistDetail→AlbumDetail(B)
 * 时返回会回 Main 而非 ArtistDetail），与设置返回 bug 同类。
 * push 总是压入新实例，返回逐层回退，行为可预期。
 */
export function pushRoot<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name],
) {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    StackActions.push(name, params as never),
  );
}

export function openPlayerScreen() {
  navigateRoot("Player");
}

export function openSearchScreen() {
  navigateRoot("Main", { screen: "MainTabs", params: { screen: "SearchTab" } });
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

// 注意：当前无调用方（设置入口统一走抽屉 DrawerContent）。
// 若后续启用，需与 DrawerContent 一致携带 navId（否则 SettingsStack key 恒为
// `${target}-0`，同一分类重复打开不会重建/跳转）。
export function openSettingsScreen(category?: SettingsCategoryName) {
  navigateRoot("Main", {
    screen: "Settings",
    params: { screen: category ?? "SettingsHome" },
  });
}

export function openMvPlayerScreen(params: RootStackParamList["MvPlayer"]) {
  navigateRoot("MvPlayer", params);
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
  navigateRoot("LikedSongs");
}

export function openSearchFallbackDetailScreen(detail: SearchFallbackDetailModel) {
  pushRoot("SearchFallbackDetail", { detail });
}

export function openDailyRecommendScreen() {
  navigateRoot("DailyRecommend");
}

export function openLeaderboardScreen() {
  pushRoot("Leaderboard");
}

export function openPlaylistSquareScreen() {
  pushRoot("PlaylistSquare");
}

export function openPersonalFmScreen() {
  navigateRoot("PersonalFm");
}
