import {
  createNavigationContainerRef,
  StackActions,
} from "@react-navigation/native";
import type { SearchAlbumResult, SearchArtistResult } from "@/services/musicApi";
import type { SearchFallbackDetailModel } from "@/services/searchFallbackDetailModel";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import type { SettingsCategoryName } from "./settingsRouteModel";
import { useSettingsCategoryStore } from "@/stores/settingsCategoryStore";
import type { RootStackParamList } from "./types";
import { useLibrarySectionStore, type LibrarySection } from "@/stores/librarySectionStore";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * 导航到根 Stack 内的页面。
 *
 * 2026-10 重构：根容器从 Drawer 改为 Stack，所有页面（含设置）都在同一个栈里，
 * 不再需要「Main 分支」这一层嵌套。
 */
export function navigateRoot<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name],
) {
  if (!navigationRef.isReady()) return;
  (navigationRef.navigate as (screen: string, params?: unknown) => void)(name, params);
}

/**
 * 栈内 push 语义导航。详情页间链式跳转（如 专辑 → 歌手 → 专辑）
 * 必须用 push：navigate 在目标 screen 已存在于栈中时会“回退到旧实例并更新参数”，
 * 导致返回键直接跳回更早的页面。push 总是压入新实例，返回逐层回退。
 */
export function pushRoot<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name],
) {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(StackActions.push(name, params as never));
}

export function openPlayerScreen() {
  navigateRoot("Player");
}

export function openSearchScreen() {
  navigateRoot("MainTabs", {
    screen: "SearchTab",
  });
}

export function openLibrarySection(section: LibrarySection) {
  useLibrarySectionStore.getState().requestSection(section);
  navigateRoot("MainTabs", { screen: "LibraryTab" });
}

export function openHistoryScreen() {
  openLibrarySection("history");
}

export function openDownloadsScreen() {
  openLibrarySection("downloads");
}

/** 「我的」Tab：首页头像、播放页头像等入口共用 */
export function openMyMusicTab() {
  navigateRoot("MainTabs", { screen: "MyMusicTab" });
}

export function openSettingsScreen(category?: SettingsCategoryName) {
  // 分类请求写入 store，设置区据此切换页面；无分类时回到设置首页，
  // 避免上次停留的分类成为下次打开的默认页。
  if (category) {
    useSettingsCategoryStore.getState().requestCategory(category);
  } else {
    useSettingsCategoryStore.getState().resetToHome();
  }
  navigateRoot("Settings");
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

export function openLikedSongsScreen() {
  navigateRoot("LikedSongs");
}

/** 听歌统计（我的页入口）：聚合本地播放历史，见 screens/ListeningStatsScreen。 */
export function openListeningStatsScreen() {
  navigateRoot("ListeningStats");
}

export function openSearchFallbackDetailScreen(detail: SearchFallbackDetailModel) {
  pushRoot("SearchFallbackDetail", { detail });
}

export function openDailyRecommendScreen() {
  navigateRoot("DailyRecommend");
}

export function openCloudDriveScreen() {
  pushRoot("CloudDrive");
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

export function openSimilarSongsScreen(params: { songId: string; songName: string }) {
  pushRoot("SimilarSongs", params);
}
