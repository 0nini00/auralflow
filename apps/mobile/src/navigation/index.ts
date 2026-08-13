/**
 * 导航类型与参数（Root Stack + Main Drawer + 内容详情）。
 */
export type {
  MainDrawerParamList,
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
  openSettingsScreen,
  openMvPlayerScreen,
  openArtistDetailScreen,
  openAlbumDetailScreen,
  openPlaylistDetailScreen,
  openLocalPlaylistDetailScreen,
  openBiliCollectionDetailScreen,
  openLikedSongsScreen,
  openSearchFallbackDetailScreen,
  openDailyRecommendScreen,
  openPersonalFmScreen,
} from "./navigationRef";
export { RootNavigator } from "./RootNavigator";
export { MainDrawerNavigator } from "./MainDrawerNavigator";
export { SettingsNavigator } from "./SettingsNavigator";
