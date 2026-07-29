# AuralFlow Mobile Search & Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Android mobile app from a single-screen MVP into a tabbed app with typed navigation, five-way search categories, and artist/album/playlist detail screens that can hand songs to the existing mobile player.

**Architecture:** Keep playback and history storage lightweight, but move navigation, search orchestration, and detail fetching into explicit mobile-only modules. Reuse only pure shared code from `@lx/core` and keep desktop Tauri/store code out of the React Native app by introducing mobile-specific services and route helpers.

**Tech Stack:** React Native 0.86, React 19, TypeScript, React Navigation, `react-native-track-player`, AsyncStorage, `@lx/core`, Vitest

## Global Constraints

- Search page must support `综合 / 单曲 / 歌手 / 专辑 / 歌单`.
- Song playback must continue to reuse the current mobile playback chain.
- Artist detail and album detail are Netease-only in this phase.
- Playlist detail must support Netease and QQ search results in this phase.
- Do not implement Netease login, cookie/scanner login, downloads, local music scan, or offline playback in this phase.
- Do not bring desktop Tauri/store dependencies into the mobile app.
- `pnpm mobile:typecheck` must pass before calling the work complete.
- If tests are added, `pnpm --filter @auralflow/mobile test` must pass before calling the work complete.

---

## File Map

- `apps/mobile/package.json`: add navigation and test dependencies, plus a `test` script.
- `apps/mobile/vitest.config.ts`: Vitest config for pure TypeScript helper tests in the mobile workspace.
- `apps/mobile/index.js`: ensure React Navigation prerequisites are loaded before app bootstrap.
- `apps/mobile/App.tsx`: reduce to a thin entry that mounts the new navigator.
- `apps/mobile/src/navigation/types.ts`: typed stack/tab route definitions.
- `apps/mobile/src/navigation/routeHelpers.ts`: pure helpers that decide whether a result can open a detail screen and build typed route params.
- `apps/mobile/src/navigation/AppNavigator.tsx`: root stack + tab navigator wiring.
- `apps/mobile/src/playback/PlaybackControllerProvider.tsx`: lightweight global playback context for mobile screens.
- `apps/mobile/src/components/Artwork.tsx`: extracted art/fallback component from the current monolith.
- `apps/mobile/src/components/SectionHeader.tsx`: extracted section heading component.
- `apps/mobile/src/components/QuickCard.tsx`: extracted library/home quick card component.
- `apps/mobile/src/components/SongRow.tsx`: reusable track row with play affordance.
- `apps/mobile/src/components/SongList.tsx`: reusable list wrapper for track rows.
- `apps/mobile/src/components/ResultTabs.tsx`: segmented control for search categories.
- `apps/mobile/src/components/LoadingState.tsx`: shared loading/error/empty presentation.
- `apps/mobile/src/components/MiniPlayer.tsx`: extracted persistent mini-player.
- `apps/mobile/src/components/SummaryCard.tsx`: reusable card for overview result blocks.
- `apps/mobile/src/screens/HomeScreen.tsx`: extracted current home/featured content.
- `apps/mobile/src/screens/LibraryScreen.tsx`: extracted current library placeholder content.
- `apps/mobile/src/screens/PlayerScreen.tsx`: extracted current player screen.
- `apps/mobile/src/screens/SearchScreen.tsx`: new multi-category search UI.
- `apps/mobile/src/screens/ArtistDetailScreen.tsx`: Netease artist detail UI.
- `apps/mobile/src/screens/AlbumDetailScreen.tsx`: Netease album detail UI.
- `apps/mobile/src/screens/PlaylistDetailScreen.tsx`: Netease/QQ playlist detail UI.
- `apps/mobile/src/services/musicApi.ts`: keep built-in song search/url/lyric helpers and add any small fetch helpers shared by mobile services.
- `apps/mobile/src/services/mobileSearchOverview.ts`: pure overview-picking logic built on shared search result helpers.
- `apps/mobile/src/services/mobileSearchService.ts`: mobile search orchestration across songs/artists/albums/playlists.
- `apps/mobile/src/services/mobileDetailService.ts`: mobile-only detail loaders for artist/album/playlist.
- `apps/mobile/src/services/__tests__/mobileSearchOverview.test.ts`: unit tests for shared search result aggregation + overview selection.
- `apps/mobile/src/services/__tests__/mobileSearchService.test.ts`: unit tests for search result composition and detail availability.
- `apps/mobile/src/services/__tests__/mobileDetailService.test.ts`: unit tests for detail-source guards and response mapping.
- `packages/core/src/search/aggregation.ts`: pure search-result helpers moved into the shared workspace package.
- `packages/core/src/search/index.ts`: barrel export for shared search helpers.
- `packages/core/src/index.ts`: export the new shared search helpers.

## Task 1: Add Shared Search Helpers And A Mobile Test Harness

**Files:**
- Create: `packages/core/src/search/aggregation.ts`
- Create: `packages/core/src/search/index.ts`
- Create: `apps/mobile/vitest.config.ts`
- Create: `apps/mobile/src/services/mobileSearchOverview.ts`
- Create: `apps/mobile/src/services/__tests__/mobileSearchOverview.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/mobile/package.json`

**Interfaces:**
- Consumes: `SearchResult`, `SearchType`, `ArtistInfo`, `AlbumInfo`, `PlaylistInfo`, `MusicInfo` from `@lx/core`
- Produces: `SEARCH_ALL_TYPES: readonly SearchType[]`
- Produces: `createEmptySearchResult(): SearchResult`
- Produces: `mergeSearchResultInto(target: SearchResult, incoming: SearchResult): void`
- Produces: `countSearchResults(result: SearchResult): number`
- Produces: `buildMobileSearchOverview(result: SearchResult): { artist: ArtistInfo | null; album: AlbumInfo | null; playlist: PlaylistInfo | null; songs: MusicInfo[] }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/services/__tests__/mobileSearchOverview.test.ts
import { describe, expect, it } from "vitest";
import {
  createEmptySearchResult,
  mergeSearchResultInto,
  countSearchResults,
  type SearchResult,
} from "@lx/core";
import { buildMobileSearchOverview } from "../mobileSearchOverview";

describe("mobileSearchOverview", () => {
  it("counts merged search categories and picks mobile overview highlights", () => {
    const target = createEmptySearchResult();
    const incoming: SearchResult = {
      songs: [
        { id: "s1", name: "Song A", singer: "Singer A", albumName: "Album A", source: "wy" },
      ],
      artists: [
        { id: "a1", name: "Singer A", source: "wy", musicSize: 10, albumSize: 2 },
      ],
      albums: [
        { id: "al1", name: "Album A", artist: "Singer A", source: "wy", publishTime: 1700000000000 },
      ],
      playlists: [
        { id: "p1", name: "Playlist A", author: "Author A", source: "wy" },
      ],
    };

    mergeSearchResultInto(target, incoming);
    expect(countSearchResults(target)).toBe(4);

    const overview = buildMobileSearchOverview(target);
    expect(overview.artist?.id).toBe("a1");
    expect(overview.album?.id).toBe("al1");
    expect(overview.playlist?.id).toBe("p1");
    expect(overview.songs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/mobileSearchOverview.test.ts
```

Expected: FAIL because `vitest` is not configured yet and/or `@lx/core` does not export the new search helpers.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/search/aggregation.ts
import type { AlbumInfo, ArtistInfo, MusicInfo, PlaylistInfo, SearchResult, SearchType } from "../sources";

export const SEARCH_ALL_TYPES = ["song", "playlist", "singer", "album"] as const satisfies readonly SearchType[];

export function createEmptySearchResult(): SearchResult {
  return { songs: [], playlists: [], artists: [], albums: [] };
}

export function mergeSearchResultInto(target: SearchResult, incoming: SearchResult): void {
  target.songs?.push(...(incoming.songs ?? []));
  target.playlists?.push(...(incoming.playlists ?? []));
  target.artists?.push(...(incoming.artists ?? []));
  target.albums?.push(...(incoming.albums ?? []));
}

export function countSearchResults(result: SearchResult): number {
  return (
    (result.songs?.length ?? 0) +
    (result.playlists?.length ?? 0) +
    (result.artists?.length ?? 0) +
    (result.albums?.length ?? 0)
  );
}
```

```ts
// apps/mobile/src/services/mobileSearchOverview.ts
import type { AlbumInfo, ArtistInfo, MusicInfo, PlaylistInfo, SearchResult } from "@lx/core";

export interface MobileSearchOverview {
  artist: ArtistInfo | null;
  album: AlbumInfo | null;
  playlist: PlaylistInfo | null;
  songs: MusicInfo[];
}

function pickFeaturedAlbum(albums: AlbumInfo[]): AlbumInfo | null {
  if (albums.length === 0) return null;
  return [...albums].sort((left, right) => (right.publishTime ?? 0) - (left.publishTime ?? 0))[0];
}

export function buildMobileSearchOverview(result: SearchResult): MobileSearchOverview {
  return {
    artist: result.artists?.[0] ?? null,
    album: pickFeaturedAlbum(result.albums ?? []),
    playlist: result.playlists?.[0] ?? null,
    songs: result.songs ?? [],
  };
}
```

```json
// apps/mobile/package.json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^2.1.5"
  }
}
```

```ts
// apps/mobile/vitest.config.ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@lx/core": resolve(__dirname, "../../packages/core/src"),
    },
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @auralflow/mobile test -- src/services/__tests__/mobileSearchOverview.test.ts
```

Expected: PASS with one passing test.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/vitest.config.ts apps/mobile/src/services/mobileSearchOverview.ts apps/mobile/src/services/__tests__/mobileSearchOverview.test.ts packages/core/src/search/aggregation.ts packages/core/src/search/index.ts packages/core/src/index.ts pnpm-lock.yaml
git commit -m "feat: add shared mobile search helpers"
```

### Task 2: Introduce Typed Navigation And Extract The Existing Tab Shell

**Files:**
- Create: `apps/mobile/src/navigation/types.ts`
- Create: `apps/mobile/src/navigation/routeHelpers.ts`
- Create: `apps/mobile/src/navigation/AppNavigator.tsx`
- Create: `apps/mobile/src/navigation/__tests__/routeHelpers.test.ts`
- Create: `apps/mobile/src/playback/PlaybackControllerProvider.tsx`
- Create: `apps/mobile/src/components/Artwork.tsx`
- Create: `apps/mobile/src/components/SectionHeader.tsx`
- Create: `apps/mobile/src/components/QuickCard.tsx`
- Create: `apps/mobile/src/components/SongRow.tsx`
- Create: `apps/mobile/src/components/SongList.tsx`
- Create: `apps/mobile/src/components/MiniPlayer.tsx`
- Create: `apps/mobile/src/screens/HomeScreen.tsx`
- Create: `apps/mobile/src/screens/SearchScreen.tsx`
- Create: `apps/mobile/src/screens/LibraryScreen.tsx`
- Create: `apps/mobile/src/screens/PlayerScreen.tsx`
- Create: `apps/mobile/src/screens/ArtistDetailScreen.tsx`
- Create: `apps/mobile/src/screens/AlbumDetailScreen.tsx`
- Create: `apps/mobile/src/screens/PlaylistDetailScreen.tsx`
- Modify: `apps/mobile/App.tsx`
- Modify: `apps/mobile/index.js`
- Modify: `apps/mobile/package.json`

**Interfaces:**
- Consumes: `MusicInfo`, `ArtistInfo`, `AlbumInfo`, `PlaylistInfo` from `@lx/core`
- Produces: `type MainTabParamList`
- Produces: `type RootStackParamList`
- Produces: `usePlaybackController(): { playback: PlaybackState; playSong(song: MusicInfo): Promise<void>; togglePlayback(): Promise<void> }`
- Produces: `buildArtistDetailRoute(artist: ArtistInfo): { name: "ArtistDetail"; params: { artistId: string; source: "wy" } } | null`
- Produces: `buildAlbumDetailRoute(album: AlbumInfo): { name: "AlbumDetail"; params: { albumId: string; source: "wy" } } | null`
- Produces: `buildPlaylistDetailRoute(playlist: PlaylistInfo): { name: "PlaylistDetail"; params: { playlistId: string; source: "wy" | "tx"; title?: string } } | null`
- Produces: `export interface PlaybackState { current: MusicInfo | null; lyrics: LyricLine[]; isPlaying: boolean; loading: boolean; error: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/navigation/__tests__/routeHelpers.test.ts
import { describe, expect, it } from "vitest";
import { buildAlbumDetailRoute, buildArtistDetailRoute, buildPlaylistDetailRoute } from "../routeHelpers";

describe("routeHelpers", () => {
  it("creates typed detail routes only for supported sources", () => {
    expect(buildArtistDetailRoute({ id: "1", name: "Singer", source: "wy" })).toEqual({
      name: "ArtistDetail",
      params: { artistId: "1", source: "wy" },
    });

    expect(buildAlbumDetailRoute({ id: "2", name: "Album", artist: "Singer", source: "tx" })).toBeNull();

    expect(buildPlaylistDetailRoute({ id: "3", name: "Playlist", author: "Author", source: "tx" })).toEqual({
      name: "PlaylistDetail",
      params: { playlistId: "3", source: "tx", title: "Playlist" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @auralflow/mobile test -- src/navigation/__tests__/routeHelpers.test.ts
```

Expected: FAIL because `routeHelpers.ts` and the typed navigation contracts do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/mobile/src/navigation/types.ts
export type MainTabParamList = {
  HomeTab: undefined;
  SearchTab: undefined;
  LibraryTab: undefined;
  PlayerTab: undefined;
};

export type RootStackParamList = {
  MainTabs: undefined;
  ArtistDetail: { artistId: string; source: "wy" };
  AlbumDetail: { albumId: string; source: "wy" };
  PlaylistDetail: { playlistId: string; source: "wy" | "tx"; title?: string };
};
```

```ts
// apps/mobile/src/navigation/routeHelpers.ts
import type { AlbumInfo, ArtistInfo, PlaylistInfo } from "@lx/core";

export function buildArtistDetailRoute(artist: ArtistInfo) {
  if (artist.source !== "wy") return null;
  return { name: "ArtistDetail" as const, params: { artistId: artist.id, source: "wy" as const } };
}

export function buildAlbumDetailRoute(album: AlbumInfo) {
  if (album.source !== "wy") return null;
  return { name: "AlbumDetail" as const, params: { albumId: album.id, source: "wy" as const } };
}

export function buildPlaylistDetailRoute(playlist: PlaylistInfo) {
  if (playlist.source !== "wy" && playlist.source !== "tx") return null;
  return {
    name: "PlaylistDetail" as const,
    params: { playlistId: playlist.id, source: playlist.source, title: playlist.name || undefined },
  };
}
```

```tsx
// apps/mobile/src/navigation/AppNavigator.tsx
import "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "@/screens/HomeScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { PlayerScreen } from "@/screens/PlayerScreen";
import { ArtistDetailScreen } from "@/screens/ArtistDetailScreen";
import { AlbumDetailScreen } from "@/screens/AlbumDetailScreen";
import { PlaylistDetailScreen } from "@/screens/PlaylistDetailScreen";
import { PlaybackControllerProvider } from "@/playback/PlaybackControllerProvider";
import type { MainTabParamList, RootStackParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="HomeTab" component={HomeScreen} />
      <Tab.Screen name="SearchTab" component={SearchScreen} />
      <Tab.Screen name="LibraryTab" component={LibraryScreen} />
      <Tab.Screen name="PlayerTab" component={PlayerScreen} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <PlaybackControllerProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="ArtistDetail" component={ArtistDetailScreen} options={{ title: "歌手" }} />
          <Stack.Screen name="AlbumDetail" component={AlbumDetailScreen} options={{ title: "专辑" }} />
          <Stack.Screen name="PlaylistDetail" component={PlaylistDetailScreen} options={{ title: "歌单" }} />
        </Stack.Navigator>
      </NavigationContainer>
    </PlaybackControllerProvider>
  );
}
```

```tsx
// apps/mobile/src/playback/PlaybackControllerProvider.tsx
import React, { createContext, useContext, useMemo, useState } from "react";
import type { LyricLine, MusicInfo } from "@lx/core";
import { fetchSongLyrics, resolveSongUrl } from "@/services/musicApi";
import { playMobileTrack, pauseMobileTrack, resumeMobileTrack } from "@/player/mobilePlayer";
import { addHistorySong } from "@/storage/historyStore";

export interface PlaybackState {
  current: MusicInfo | null;
  lyrics: LyricLine[];
  isPlaying: boolean;
  loading: boolean;
  error: string | null;
}

const PlaybackContext = createContext<{
  playback: PlaybackState;
  playSong(song: MusicInfo): Promise<void>;
  togglePlayback(): Promise<void>;
} | null>(null);

export function PlaybackControllerProvider({ children }: { children: React.ReactNode }) {
  const [playback, setPlayback] = useState<PlaybackState>({
    current: null,
    lyrics: [],
    isPlaying: false,
    loading: false,
    error: null,
  });

  async function playSong(song: MusicInfo) {
    setPlayback((state) => ({ ...state, current: song, loading: true, error: null }));
    const [{ url }, lyrics] = await Promise.all([resolveSongUrl(song), fetchSongLyrics(song)]);
    await playMobileTrack(song, url);
    await addHistorySong(song);
    setPlayback({ current: song, lyrics, isPlaying: true, loading: false, error: null });
  }

  async function togglePlayback() {
    if (!playback.current) return;
    if (playback.isPlaying) {
      await pauseMobileTrack();
      setPlayback((state) => ({ ...state, isPlaying: false }));
      return;
    }
    await resumeMobileTrack();
    setPlayback((state) => ({ ...state, isPlaying: true }));
  }

  const value = useMemo(() => ({ playback, playSong, togglePlayback }), [playback]);
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlaybackController() {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error("usePlaybackController must be used inside PlaybackControllerProvider");
  return value;
}
```

```tsx
// apps/mobile/src/screens/SearchScreen.tsx
import React from "react";
import { Text, View } from "react-native";

export function SearchScreen() {
  return (
    <View>
      <Text>搜索</Text>
    </View>
  );
}
```

```tsx
// apps/mobile/src/screens/ArtistDetailScreen.tsx
import React from "react";
import { Text, View } from "react-native";

export function ArtistDetailScreen() {
  return (
    <View>
      <Text>歌手详情</Text>
    </View>
  );
}
```

```tsx
// apps/mobile/src/screens/AlbumDetailScreen.tsx
import React from "react";
import { Text, View } from "react-native";

export function AlbumDetailScreen() {
  return (
    <View>
      <Text>专辑详情</Text>
    </View>
  );
}
```

```tsx
// apps/mobile/src/screens/PlaylistDetailScreen.tsx
import React from "react";
import { Text, View } from "react-native";

export function PlaylistDetailScreen() {
  return (
    <View>
      <Text>歌单详情</Text>
    </View>
  );
}
```

```tsx
// apps/mobile/App.tsx
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "react-native";
import { AppNavigator } from "@/navigation/AppNavigator";

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#10241f" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}
```

```js
// apps/mobile/index.js
import "react-native-gesture-handler";
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @auralflow/mobile test -- src/navigation/__tests__/routeHelpers.test.ts
pnpm mobile:typecheck
```

Expected: route helper test PASS, then TypeScript succeeds with the extracted shell compiling.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/App.tsx apps/mobile/index.js apps/mobile/package.json apps/mobile/src/navigation apps/mobile/src/playback/PlaybackControllerProvider.tsx apps/mobile/src/components/Artwork.tsx apps/mobile/src/components/SectionHeader.tsx apps/mobile/src/components/QuickCard.tsx apps/mobile/src/components/SongRow.tsx apps/mobile/src/components/SongList.tsx apps/mobile/src/components/MiniPlayer.tsx apps/mobile/src/screens/HomeScreen.tsx apps/mobile/src/screens/SearchScreen.tsx apps/mobile/src/screens/LibraryScreen.tsx apps/mobile/src/screens/PlayerScreen.tsx apps/mobile/src/screens/ArtistDetailScreen.tsx apps/mobile/src/screens/AlbumDetailScreen.tsx apps/mobile/src/screens/PlaylistDetailScreen.tsx pnpm-lock.yaml
git commit -m "feat: add typed mobile navigation shell"
```

### Task 3: Build The Multi-Category Search Service And Search Screen

**Files:**
- Create: `apps/mobile/src/services/mobileSearchService.ts`
- Create: `apps/mobile/src/services/__tests__/mobileSearchService.test.ts`
- Create: `apps/mobile/src/components/ResultTabs.tsx`
- Create: `apps/mobile/src/components/LoadingState.tsx`
- Create: `apps/mobile/src/components/SummaryCard.tsx`
- Modify: `apps/mobile/src/screens/SearchScreen.tsx`
- Modify: `apps/mobile/src/services/musicApi.ts`
- Modify: `apps/mobile/src/navigation/AppNavigator.tsx`

**Interfaces:**
- Consumes: `SEARCH_ALL_TYPES`, `createEmptySearchResult`, `mergeSearchResultInto`, `countSearchResults` from Task 1
- Consumes: `buildArtistDetailRoute`, `buildAlbumDetailRoute`, `buildPlaylistDetailRoute` from Task 2
- Produces: `type MobileSearchFilter = "overview" | "song" | "artist" | "album" | "playlist"`
- Produces: `searchMobileCatalog(keyword: string): Promise<SearchResult>`
- Produces: `getVisibleSearchCount(result: SearchResult, filter: MobileSearchFilter): number`
- Produces: `canOpenArtistDetail(source: SourceTag): boolean`
- Produces: `canOpenAlbumDetail(source: SourceTag): boolean`
- Produces: `canOpenPlaylistDetail(source: SourceTag): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/services/__tests__/mobileSearchService.test.ts
import { describe, expect, it } from "vitest";
import type { SearchResult } from "@lx/core";
import {
  canOpenAlbumDetail,
  canOpenArtistDetail,
  canOpenPlaylistDetail,
  getVisibleSearchCount,
} from "../mobileSearchService";

describe("mobileSearchService helpers", () => {
  it("reports visible counts and source support consistently", () => {
    const result: SearchResult = {
      songs: [{ id: "s1", name: "Song", singer: "Singer", albumName: "Album", source: "wy" }],
      artists: [{ id: "a1", name: "Singer", source: "wy" }],
      albums: [{ id: "al1", name: "Album", artist: "Singer", source: "wy" }],
      playlists: [{ id: "p1", name: "Playlist", author: "Author", source: "tx" }],
    };

    expect(getVisibleSearchCount(result, "overview")).toBe(4);
    expect(canOpenArtistDetail("wy")).toBe(true);
    expect(canOpenArtistDetail("tx")).toBe(false);
    expect(canOpenAlbumDetail("wy")).toBe(true);
    expect(canOpenPlaylistDetail("tx")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @auralflow/mobile test -- src/services/__tests__/mobileSearchService.test.ts
```

Expected: FAIL because `mobileSearchService.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/mobile/src/services/mobileSearchService.ts
import {
  countSearchResults,
  createEmptySearchResult,
  mergeSearchResultInto,
  type SearchResult,
  type SourceTag,
} from "@lx/core";
import {
  searchSongs,
  searchWyAlbums,
  searchWyArtists,
  searchWyPlaylists,
  searchTxPlaylists,
} from "./musicApi";

export type MobileSearchFilter = "overview" | "song" | "artist" | "album" | "playlist";

export function getVisibleSearchCount(result: SearchResult, filter: MobileSearchFilter): number {
  if (filter === "overview") return countSearchResults(result);
  if (filter === "song") return result.songs?.length ?? 0;
  if (filter === "artist") return result.artists?.length ?? 0;
  if (filter === "album") return result.albums?.length ?? 0;
  return result.playlists?.length ?? 0;
}

export function canOpenArtistDetail(source: SourceTag): boolean {
  return source === "wy";
}

export function canOpenAlbumDetail(source: SourceTag): boolean {
  return source === "wy";
}

export function canOpenPlaylistDetail(source: SourceTag): boolean {
  return source === "wy" || source === "tx";
}

export async function searchMobileCatalog(keyword: string): Promise<SearchResult> {
  const [songs, artists, albums, wyPlaylists, txPlaylists] = await Promise.all([
    searchSongs("wy", keyword),
    searchWyArtists(keyword),
    searchWyAlbums(keyword),
    searchWyPlaylists(keyword),
    searchTxPlaylists(keyword),
  ]);
  const result = createEmptySearchResult();
  mergeSearchResultInto(result, {
    songs,
    artists,
    albums,
    playlists: [...wyPlaylists, ...txPlaylists],
  });
  return result;
}
```

```ts
// apps/mobile/src/services/musicApi.ts
export async function searchWyArtists(keyword: string): Promise<ArtistInfo[]> {
  return fetchWySearchCategory(keyword, "artist");
}

export async function searchWyAlbums(keyword: string): Promise<AlbumInfo[]> {
  return fetchWySearchCategory(keyword, "album");
}

export async function searchWyPlaylists(keyword: string): Promise<PlaylistInfo[]> {
  return fetchWySearchCategory(keyword, "playlist");
}

export async function searchTxPlaylists(keyword: string): Promise<PlaylistInfo[]> {
  return fetchTxPlaylistCategory(keyword);
}
```

```tsx
// apps/mobile/src/screens/SearchScreen.tsx
import React, { useMemo, useState } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { buildMobileSearchOverview } from "@/services/mobileSearchOverview";
import {
  canOpenAlbumDetail,
  canOpenArtistDetail,
  canOpenPlaylistDetail,
  getVisibleSearchCount,
  searchMobileCatalog,
  type MobileSearchFilter,
} from "@/services/mobileSearchService";
import {
  buildAlbumDetailRoute,
  buildArtistDetailRoute,
  buildPlaylistDetailRoute,
} from "@/navigation/routeHelpers";
import { ResultTabs } from "@/components/ResultTabs";
import { SongList } from "@/components/SongList";
import { SummaryCard } from "@/components/SummaryCard";

export function SearchScreen() {
  const navigation = useNavigation();
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<MobileSearchFilter>("overview");
  const [result, setResult] = useState({ songs: [], artists: [], albums: [], playlists: [] });
  const overview = useMemo(() => buildMobileSearchOverview(result), [result]);

  async function submit() {
    const next = await searchMobileCatalog(keyword.trim());
    setResult(next);
  }

  return (
    <ScrollView>
      <TextInput value={keyword} onChangeText={setKeyword} onSubmitEditing={submit} />
      <ResultTabs
        value={filter}
        count={getVisibleSearchCount(result, filter)}
        onChange={setFilter}
      />
      {filter === "overview" && overview.artist ? (
        <View>
          <SummaryCard
            title={overview.artist.name}
            caption="歌手"
            onPress={() => {
              const route = buildArtistDetailRoute(overview.artist!);
              if (!route) return Alert.alert("暂不支持", "当前来源暂不支持歌手详情");
              navigation.navigate(route.name, route.params);
            }}
          />
          <SongList songs={overview.songs} onPlay={() => {}} />
        </View>
      ) : (
        <SongList songs={result.songs ?? []} onPlay={() => {}} />
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @auralflow/mobile test -- src/services/__tests__/mobileSearchService.test.ts
pnpm mobile:typecheck
```

Expected: helper tests PASS and TypeScript succeeds with the new search screen compiled.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/services/mobileSearchService.ts apps/mobile/src/services/__tests__/mobileSearchService.test.ts apps/mobile/src/components/ResultTabs.tsx apps/mobile/src/components/LoadingState.tsx apps/mobile/src/components/SummaryCard.tsx apps/mobile/src/screens/SearchScreen.tsx apps/mobile/src/services/musicApi.ts apps/mobile/src/navigation/AppNavigator.tsx
git commit -m "feat: add mobile multi-category search"
```

### Task 4: Add Netease Artist And Album Detail Services And Screens

**Files:**
- Create: `apps/mobile/src/services/mobileDetailService.ts`
- Create: `apps/mobile/src/services/__tests__/mobileDetailService.test.ts`
- Modify: `apps/mobile/src/screens/ArtistDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/AlbumDetailScreen.tsx`
- Modify: `apps/mobile/src/navigation/AppNavigator.tsx`

**Interfaces:**
- Consumes: `playMobileTrack`, `resolveSongUrl`, `fetchSongLyrics`, `addHistorySong`
- Produces: `loadArtistDetail(artistId: string): Promise<{ info: ArtistInfo; songs: MusicInfo[]; albums: AlbumInfo[] }>`
- Produces: `loadAlbumDetail(albumId: string): Promise<{ info: AlbumInfo & { description?: string }; songs: MusicInfo[] }>`
- Produces: `playSongFromDetail(song: MusicInfo): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/services/__tests__/mobileDetailService.test.ts
import { describe, expect, it } from "vitest";
import { mapArtistDetailResponse, mapAlbumDetailResponse } from "../mobileDetailService";

describe("mobileDetailService mapping", () => {
  it("maps netease artist and album payloads into mobile detail models", () => {
    const artist = mapArtistDetailResponse(
      { data: { artist: { id: 1, name: "Singer", cover: "cover.jpg", musicSize: 12, albumSize: 3 } } },
      { songs: [{ id: 11, name: "Song", ar: [{ name: "Singer" }], al: { name: "Album", picUrl: "cover.jpg" } }] },
      { hotAlbums: [{ id: 21, name: "Album", picUrl: "cover.jpg", artist: { id: 1, name: "Singer" }, publishTime: 1700000000000, size: 10 }] },
    );

    expect(artist.info.id).toBe("1");
    expect(artist.songs[0].name).toBe("Song");
    expect(artist.albums[0].id).toBe("21");

    const album = mapAlbumDetailResponse({
      album: { id: 31, name: "Album", picUrl: "cover.jpg", artist: { id: 1, name: "Singer" }, publishTime: 1700000000000, description: "Desc" },
      songs: [{ id: 41, name: "Song", ar: [{ name: "Singer" }], al: { name: "Album", picUrl: "cover.jpg" } }],
    });

    expect(album.info.id).toBe("31");
    expect(album.info.description).toBe("Desc");
    expect(album.songs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @auralflow/mobile test -- src/services/__tests__/mobileDetailService.test.ts
```

Expected: FAIL because the mapping functions and detail service do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/mobile/src/services/mobileDetailService.ts
import type { AlbumInfo, ArtistInfo, MusicInfo } from "@lx/core";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function mapArtistDetailResponse(detailBody: any, songsBody: any, albumsBody: any): {
  info: ArtistInfo & { musicSize?: number; albumSize?: number };
  songs: MusicInfo[];
  albums: AlbumInfo[];
} {
  const artist = detailBody?.data?.artist ?? {};
  return {
    info: {
      id: String(artist.id ?? ""),
      name: String(artist.name ?? ""),
      picUrl: String(artist.cover ?? artist.picUrl ?? ""),
      musicSize: Number(artist.musicSize ?? 0),
      albumSize: Number(artist.albumSize ?? 0),
      source: "wy",
    },
    songs: ((songsBody?.songs ?? []) as any[]).map((song) => ({
      id: String(song.id),
      name: String(song.name ?? ""),
      singer: (song.ar ?? []).map((item: any) => item.name).join("、"),
      albumName: String(song.al?.name ?? ""),
      picUrl: String(song.al?.picUrl ?? ""),
      img: String(song.al?.picUrl ?? ""),
      source: "wy" as const,
    })),
    albums: ((albumsBody?.hotAlbums ?? []) as any[]).map((album) => ({
      id: String(album.id),
      name: String(album.name ?? ""),
      picUrl: String(album.picUrl ?? ""),
      artist: String(album.artist?.name ?? ""),
      artistId: String(album.artist?.id ?? ""),
      publishTime: Number(album.publishTime ?? 0),
      trackCount: Number(album.size ?? 0),
      source: "wy" as const,
    })),
  };
}

export function mapAlbumDetailResponse(body: any): {
  info: AlbumInfo & { description?: string };
  songs: MusicInfo[];
} {
  const album = body?.album ?? {};
  return {
    info: {
      id: String(album.id ?? ""),
      name: String(album.name ?? ""),
      picUrl: String(album.picUrl ?? ""),
      artist: String(album.artist?.name ?? ""),
      artistId: String(album.artist?.id ?? ""),
      publishTime: Number(album.publishTime ?? 0),
      trackCount: Number(album.size ?? (body?.songs ?? []).length),
      description: typeof album.description === "string" ? album.description : undefined,
      source: "wy",
    },
    songs: ((body?.songs ?? []) as any[]).map((song) => ({
      id: String(song.id),
      name: String(song.name ?? ""),
      singer: (song.ar ?? []).map((item: any) => item.name).join("、"),
      albumName: String(song.al?.name ?? ""),
      picUrl: String(song.al?.picUrl ?? ""),
      img: String(song.al?.picUrl ?? ""),
      source: "wy" as const,
    })),
  };
}

export async function loadArtistDetail(artistId: string) {
  const [detailBody, songsBody, albumsBody] = await Promise.all([
    fetchJson(`https://music.163.com/api/artist/head/info/get?id=${encodeURIComponent(artistId)}`),
    fetchJson(`https://music.163.com/api/v1/artist/songs?id=${encodeURIComponent(artistId)}&limit=100&offset=0`),
    fetchJson(`https://music.163.com/api/artist/albums/${encodeURIComponent(artistId)}?limit=100&offset=0`),
  ]);
  return mapArtistDetailResponse(detailBody, songsBody, albumsBody);
}

export async function loadAlbumDetail(albumId: string) {
  const body = await fetchJson(`https://music.163.com/api/v1/album/${encodeURIComponent(albumId)}`);
  return mapAlbumDetailResponse(body);
}
```

```tsx
// apps/mobile/src/screens/ArtistDetailScreen.tsx
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRoute } from "@react-navigation/native";
import { SongList } from "@/components/SongList";
import { loadArtistDetail } from "@/services/mobileDetailService";

export function ArtistDetailScreen() {
  const route = useRoute<any>();
  const [state, setState] = useState<{ info: any; songs: any[]; albums: any[] } | null>(null);

  useEffect(() => {
    void loadArtistDetail(route.params.artistId).then(setState);
  }, [route.params.artistId]);

  if (!state) return <Text>加载中</Text>;

  return (
    <ScrollView>
      <Text>{state.info.name}</Text>
      <SongList songs={state.songs} onPlay={() => {}} />
      <View>{state.albums.map((album) => <Text key={album.id}>{album.name}</Text>)}</View>
    </ScrollView>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @auralflow/mobile test -- src/services/__tests__/mobileDetailService.test.ts
pnpm mobile:typecheck
```

Expected: mapping tests PASS and TypeScript succeeds with the artist/album detail screens compiled.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/services/mobileDetailService.ts apps/mobile/src/services/__tests__/mobileDetailService.test.ts apps/mobile/src/screens/ArtistDetailScreen.tsx apps/mobile/src/screens/AlbumDetailScreen.tsx apps/mobile/src/navigation/AppNavigator.tsx
git commit -m "feat: add mobile artist and album detail"
```

### Task 5: Add Playlist Detail, Playback Handoff, And End-To-End Verification

**Files:**
- Modify: `apps/mobile/src/services/mobileDetailService.ts`
- Modify: `apps/mobile/src/services/__tests__/mobileDetailService.test.ts`
- Modify: `apps/mobile/src/screens/PlaylistDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/SearchScreen.tsx`
- Modify: `apps/mobile/src/screens/ArtistDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/AlbumDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/PlayerScreen.tsx`
- Modify: `apps/mobile/src/player/mobilePlayer.ts`

**Interfaces:**
- Consumes: `buildPlaylistDetailRoute`, `buildArtistDetailRoute`, `buildAlbumDetailRoute` from Task 2
- Consumes: `loadArtistDetail`, `loadAlbumDetail` from Task 4
- Produces: `loadPlaylistDetail(playlistId: string, source: "wy" | "tx"): Promise<{ info: { id: string; name: string; author: string; source: "wy" | "tx"; trackCount: number; picUrl?: string }; songs: MusicInfo[] }>`
- Produces: `playSongAndOpenPlayer(song: MusicInfo, onReady: () => void): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/services/__tests__/mobileDetailService.test.ts
import { describe, expect, it } from "vitest";
import { canLoadPlaylistDetail } from "../mobileDetailService";

describe("playlist detail support", () => {
  it("allows only wy and tx playlist detail sources", () => {
    expect(canLoadPlaylistDetail("wy")).toBe(true);
    expect(canLoadPlaylistDetail("tx")).toBe(true);
    expect(canLoadPlaylistDetail("bili")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @auralflow/mobile test -- src/services/__tests__/mobileDetailService.test.ts
```

Expected: FAIL because the playlist guard/helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/mobile/src/services/mobileDetailService.ts
import { addHistorySong } from "@/storage/historyStore";
import { fetchSongLyrics, resolveSongUrl } from "./musicApi";
import { playMobileTrack } from "@/player/mobilePlayer";
import type { MusicInfo, PlaylistInfo } from "@lx/core";

export function canLoadPlaylistDetail(source: string): source is "wy" | "tx" {
  return source === "wy" || source === "tx";
}

async function loadWyPlaylistSongs(playlist: PlaylistInfo): Promise<MusicInfo[]> {
  const body = await fetchJson<any>(`https://music.163.com/api/v3/playlist/detail?id=${encodeURIComponent(playlist.id)}&n=1000&s=8`);
  return ((body?.playlist?.tracks ?? []) as any[]).map((song) => ({
    id: String(song.id),
    name: String(song.name ?? ""),
    singer: (song.ar ?? []).map((item: any) => item.name).join("、"),
    albumName: String(song.al?.name ?? ""),
    picUrl: String(song.al?.picUrl ?? ""),
    img: String(song.al?.picUrl ?? ""),
    source: "wy" as const,
  }));
}

async function loadTxPlaylistSongs(playlist: PlaylistInfo): Promise<MusicInfo[]> {
  const body = await fetchJson<any>(`https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${encodeURIComponent(playlist.id)}`);
  return ((body?.cdlist?.[0]?.songlist ?? []) as any[]).map((song) => ({
    id: String(song.songmid ?? song.mid ?? ""),
    name: String(song.songname ?? song.title ?? ""),
    singer: (song.singer ?? []).map((item: any) => item.name).join("、"),
    albumName: String(song.albumname ?? song.album?.name ?? ""),
    source: "tx" as const,
  }));
}

export async function loadPlaylistDetail(playlistId: string, source: "wy" | "tx"): Promise<{
  info: { id: string; name: string; author: string; source: "wy" | "tx"; trackCount: number; picUrl?: string };
  songs: MusicInfo[];
}> {
  const info: PlaylistInfo = {
    id: playlistId,
    name: "",
    author: "",
    source,
  };

  const songs = source === "wy"
    ? await loadWyPlaylistSongs(info)
    : await loadTxPlaylistSongs(info);

  return {
    info: {
      id: playlistId,
      name: info.name || "歌单",
      author: info.author || "",
      source,
      trackCount: songs.length,
      picUrl: info.picUrl,
    },
    songs,
  };
}

export async function playSongAndOpenPlayer(song: MusicInfo, onReady: (lyrics: any[]) => void): Promise<void> {
  const [{ url }, lyrics] = await Promise.all([
    resolveSongUrl(song),
    fetchSongLyrics(song),
  ]);
  await playMobileTrack(song, url);
  await addHistorySong(song);
  onReady(lyrics);
}
```

```tsx
// apps/mobile/src/screens/PlaylistDetailScreen.tsx
import React, { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { useRoute } from "@react-navigation/native";
import { SongList } from "@/components/SongList";
import { loadPlaylistDetail, playSongAndOpenPlayer } from "@/services/mobileDetailService";

export function PlaylistDetailScreen() {
  const route = useRoute<any>();
  const [state, setState] = useState<{ info: any; songs: any[] } | null>(null);

  useEffect(() => {
    void loadPlaylistDetail(route.params.playlistId, route.params.source).then(setState);
  }, [route.params.playlistId, route.params.source]);

  if (!state) return <Text>加载中</Text>;

  return (
    <ScrollView>
      <Text>{state.info.name}</Text>
      <SongList songs={state.songs} onPlay={(song) => playSongAndOpenPlayer(song, () => {})} />
    </ScrollView>
  );
}
```

```tsx
// apps/mobile/src/screens/SearchScreen.tsx
import { usePlaybackController } from "@/playback/PlaybackControllerProvider";

const { playSong } = usePlaybackController();

async function handleSongPress(song: MusicInfo) {
  await playSong(song);
  navigation.navigate("PlayerTab");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @auralflow/mobile test
pnpm mobile:typecheck
```

Expected: all mobile helper tests PASS and mobile typecheck succeeds after wiring the playlist screen and playback handoff.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/services/mobileDetailService.ts apps/mobile/src/services/__tests__/mobileDetailService.test.ts apps/mobile/src/screens/PlaylistDetailScreen.tsx apps/mobile/src/screens/SearchScreen.tsx apps/mobile/src/screens/ArtistDetailScreen.tsx apps/mobile/src/screens/AlbumDetailScreen.tsx apps/mobile/src/screens/PlayerScreen.tsx apps/mobile/src/player/mobilePlayer.ts
git commit -m "feat: add mobile playlist detail and playback handoff"
```

## Self-Review

### Spec coverage

- Search page five categories: covered by Task 1 shared helpers and Task 3 search screen.
- Artist/album/playlist detail pages: covered by Tasks 4 and 5.
- Playback reuse: covered by Task 5 `playSongAndOpenPlayer`.
- Shared-code boundary: enforced in File Map, Global Constraints, and mobile-only services in Tasks 3-5.
- No login/download/local scan: explicitly excluded in Global Constraints and no tasks touch those areas.
- Verification: each task has tests or typecheck commands; final task runs the full mobile test suite and `pnpm mobile:typecheck`.

### Placeholder scan

- No unresolved placeholder markers remain in the executable tasks.
- Every task names exact files and explicit commands.
- Every code-changing step includes concrete code snippets or explicit wiring comments where the surrounding file is already established by earlier tasks.

### Type consistency

- Shared search helpers consistently use `SearchResult`.
- Navigation helpers always emit `ArtistDetail`, `AlbumDetail`, and `PlaylistDetail` route names with the same param shapes.
- Detail loaders consistently return `{ info, songs }` or `{ info, songs, albums }` structures across tasks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-auralflow-mobile-search-detail.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
