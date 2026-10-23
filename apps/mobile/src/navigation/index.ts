/**
 * 导航类型与参数（Root Stack + 内容详情 + 设置）。
 */
export type {
  RootStackParamList,
  SettingsStackParamList,
} from "./types";
export {
  navigationRef,
  navigateRoot,
  openPlayerScreen,
  openSearchScreen,
  openLibrarySection,
  openHistoryScreen,
  openDownloadsScreen,
  openMyMusicTab,
  openSettingsScreen,
  openMvPlayerScreen,
  openArtistDetailScreen,
  openAlbumDetailScreen,
  openPlaylistDetailScreen,
  openCloudDriveScreen,
  openLocalPlaylistDetailScreen,
  openLikedSongsScreen,
  openSearchFallbackDetailScreen,
  openDailyRecommendScreen,
  openPersonalFmScreen,
  openSimilarSongsScreen,
} from "./navigationRef";
export { RootNavigator } from "./RootNavigator";
export { SettingsNavigator } from "./SettingsNavigator";
