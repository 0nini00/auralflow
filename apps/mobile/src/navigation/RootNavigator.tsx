import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MainDrawerNavigator } from "@/navigation/MainDrawerNavigator";
import {
  openAlbumDetailScreen,
  openLocalPlaylistDetailScreen,
  openPlayerScreen,
} from "@/navigation/navigationRef";
import type { RootStackParamList } from "@/navigation/types";
import { AlbumDetailScreen } from "@/screens/AlbumDetailScreen";
import { ArtistDetailScreen } from "@/screens/ArtistDetailScreen";
import { BiliCollectionDetailScreen } from "@/screens/BiliCollectionDetailScreen";
import { DailyRecommendScreen } from "@/screens/DailyRecommendScreen";
import { ImmersiveLyricsScreen } from "@/screens/ImmersiveLyricsScreen";
import { LikedSongsScreen } from "@/screens/LikedSongsScreen";
import { LocalPlaylistDetailScreen } from "@/screens/LocalPlaylistDetailScreen";
import { PersonalFmScreen } from "@/screens/PersonalFmScreen";
import { PlaylistDetailScreen } from "@/screens/PlaylistDetailScreen";
import { SearchFallbackDetailScreen } from "@/screens/SearchFallbackDetailScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="Main" component={MainDrawerNavigator} />

      <Stack.Screen
        name="Player"
        options={{
          presentation: "fullScreenModal",
          animation: "slide_from_bottom",
        }}
      >
        {({ navigation }) => (
          <ImmersiveLyricsScreen visible onClose={() => navigation.goBack()} />
        )}
      </Stack.Screen>

      <Stack.Screen name="DailyRecommend">
        {({ navigation }) => (
          <DailyRecommendScreen
            onNavigateToPlayer={openPlayerScreen}
            onBack={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="PersonalFm">
        {() => <PersonalFmScreen onNavigateToPlayer={openPlayerScreen} />}
      </Stack.Screen>

      <Stack.Screen name="ArtistDetail">
        {({ navigation, route }) => (
          <ArtistDetailScreen
            artist={route.params.artist}
            onBack={() => navigation.goBack()}
            onNavigateToPlayer={openPlayerScreen}
            onOpenAlbum={(album) => openAlbumDetailScreen(album, route.params.artist)}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="AlbumDetail">
        {({ navigation, route }) => {
          const parentAlbum = {
            type: "album" as const,
            album: route.params.album,
            parentArtist: route.params.parentArtist ?? null,
          };
          return (
            <AlbumDetailScreen
              album={route.params.album}
              parentAlbum={parentAlbum}
              onBack={() => navigation.goBack()}
              onNavigateToPlayer={openPlayerScreen}
              onOpenArtist={(artistRoute) =>
                navigation.navigate("ArtistDetail", { artist: artistRoute.artist })
              }
            />
          );
        }}
      </Stack.Screen>

      <Stack.Screen name="PlaylistDetail">
        {({ navigation, route }) => (
          <PlaylistDetailScreen
            playlist={route.params.playlist}
            onBack={() => navigation.goBack()}
            onNavigateToPlayer={openPlayerScreen}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="LocalPlaylistDetail">
        {({ navigation, route }) => (
          <LocalPlaylistDetailScreen
            playlistId={route.params.playlistId}
            onBack={() => navigation.goBack()}
            onNavigateToPlayer={openPlayerScreen}
            onOpenPlaylist={(playlistId) => openLocalPlaylistDetailScreen(playlistId)}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="BiliCollectionDetail">
        {({ navigation, route }) => (
          <BiliCollectionDetailScreen
            collection={route.params.collection}
            onBack={() => navigation.goBack()}
            onNavigateToPlayer={openPlayerScreen}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="LikedSongs">
        {({ navigation }) => (
          <LikedSongsScreen
            onBack={() => navigation.goBack()}
            onNavigateToPlayer={openPlayerScreen}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="SearchFallbackDetail">
        {({ navigation, route }) => (
          <SearchFallbackDetailScreen
            detail={route.params.detail}
            onBack={() => navigation.goBack()}
            onNavigateToPlayer={openPlayerScreen}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
