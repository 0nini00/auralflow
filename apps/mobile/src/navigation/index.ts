/**
 * 导航类型与参数（Root Stack + Main Drawer + 内容详情）。
 */
export type {
  MainDrawerParamList,
  RootStackParamList,
  SettingsDrawerParamList,
  SettingsStackParamList,
} from "./types";
export {
  navigationRef,
  navigateRoot,
  openPlayerScreen,
  openArtistDetailScreen,
  openAlbumDetailScreen,
  openPlaylistDetailScreen,
  openLocalPlaylistDetailScreen,
  openBiliCollectionDetailScreen,
  openLikedSongsScreen,
  openSearchFallbackDetailScreen,
  openDailyRecommendScreen,
} from "./navigationRef";
export { RootNavigator } from "./RootNavigator";
export { MainDrawerNavigator } from "./MainDrawerNavigator";
export { SettingsNavigator } from "./SettingsNavigator";
