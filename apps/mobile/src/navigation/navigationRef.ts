import { createNavigationContainerRef } from "@react-navigation/native";
import type { BiliCollectionInfo } from "@/services/biliService";
import type { SearchAlbumResult, SearchArtistResult } from "@/services/musicApi";
import type { SearchFallbackDetailModel } from "@/services/searchFallbackDetailModel";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import type { RootStackParamList } from "./types";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateRoot<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name],
) {
  if (!navigationRef.isReady()) return;
  // @ts-expect-error react-navigation overload for optional params
  navigationRef.navigate(name, params);
}

export function openPlayerScreen() {
  navigateRoot("Player");
}

export function openArtistDetailScreen(artist: SearchArtistResult) {
  navigateRoot("ArtistDetail", { artist });
}

export function openAlbumDetailScreen(
  album: SearchAlbumResult,
  parentArtist: SearchArtistResult | null = null,
) {
  navigateRoot("AlbumDetail", { album, parentArtist });
}

export function openPlaylistDetailScreen(playlist: WyPlaylistInfo) {
  navigateRoot("PlaylistDetail", { playlist });
}

export function openLocalPlaylistDetailScreen(playlistId: string) {
  navigateRoot("LocalPlaylistDetail", { playlistId });
}

export function openBiliCollectionDetailScreen(collection: BiliCollectionInfo) {
  navigateRoot("BiliCollectionDetail", { collection });
}

export function openLikedSongsScreen() {
  navigateRoot("LikedSongs");
}

export function openSearchFallbackDetailScreen(detail: SearchFallbackDetailModel) {
  navigateRoot("SearchFallbackDetail", { detail });
}

export function openDailyRecommendScreen() {
  navigateRoot("DailyRecommend");
}

export function openPersonalFmScreen() {
  navigateRoot("PersonalFm");
}
