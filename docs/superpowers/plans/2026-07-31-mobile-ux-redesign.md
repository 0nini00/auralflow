# AuralFlow Android UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 9-item drawer navigation with a 4-tab bottom navigator + slim drawer for account/settings, while simplifying PlayerBar, splitting Library, and adding MyMusic screen.

**Architecture:** The MainDrawerNavigator stays as the outermost shell (preserving drawer gesture), but its content changes from 9 drawer screens to a BottomTabNavigator with 4 tabs. The drawer content becomes a slim account/tools/settings panel. PlayerBar shrinks to a single row. LibraryScreen splits into TopTab (playlists/bili). New MyMusicScreen gets account card + local/history/downloads TopTab.

**Tech Stack:** React Native 0.86, React 19, React Navigation 7 (drawer + native-stack + bottom-tabs + material-top-tabs), Zustand, lucide-react-native, Reanimated

## Global Constraints

- React Native 0.86, React 19, React Navigation 7
- Existing deep-link formats (`auralflow://search`, `auralflow://daily`, `auralflow://fm`) must remain compatible
- `@lx/core` shared types unchanged
- No changes to desktop端 code
- No changes to backend/API/data models
- All UI text in Chinese (matching existing codebase)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `apps/mobile/package.json` | Modify | Add `@react-navigation/bottom-tabs`, `@react-navigation/material-top-tabs`, `react-native-tab-view`, `react-native-pager-view` |
| `apps/mobile/src/navigation/types.ts` | Modify | Add `MainTabParamList`, `LibraryTopTabParamList`, `MyMusicTopTabParamList`; simplify `MainDrawerParamList` |
| `apps/mobile/src/navigation/MainDrawerNavigator.tsx` | Modify | Wrap BottomTabs inside Drawer; drawer becomes slim panel |
| `apps/mobile/src/navigation/MainTabNavigator.tsx` | Create | 4-tab bottom navigator with TopTabs inside Library and MyMusic |
| `apps/mobile/src/navigation/RootNavigator.tsx` | Modify | Add DailyRecommend / PersonalFm as RootStack screens |
| `apps/mobile/src/navigation/navigationRef.ts` | Modify | Add `openPersonalFmScreen`, update `openDailyRecommendScreen` |
| `apps/mobile/src/navigation/drawerRouteModel.ts` | Modify | Simplify for new structure |
| `apps/mobile/src/services/appNavigation.ts` | Modify | Update `APP_TABS`, add bottom tab types |
| `apps/mobile/src/components/DrawerContent.tsx` | Create | Slim drawer: account + tools + settings |
| `apps/mobile/src/components/AppHeader.tsx` | Modify | Remove forward button |
| `apps/mobile/src/components/PlayerBar.tsx` | Modify | Simplify to single row + `⋯` menu |
| `apps/mobile/src/screens/MyMusicScreen.tsx` | Create | Account card + local/history/downloads content |
| `apps/mobile/src/screens/LibraryScreen.tsx` | Modify | Accept `tab` prop for playlists/bili split |
| `apps/mobile/src/screens/HomeScreen.tsx` | Modify | Tighten spacing/font sizes |
| `apps/mobile/src/theme/tokens.ts` | Modify | Add `layout.playerBarHeight` |
| `apps/mobile/src/components/AppSidebar.tsx` | Delete | Replaced by DrawerContent |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `apps/mobile/package.json`

- [ ] **Step 1: Install bottom-tabs and material-top-tabs**

```bash
cd apps/mobile && pnpm add @react-navigation/bottom-tabs @react-navigation/material-top-tabs react-native-tab-view react-native-pager-view
```

- [ ] **Step 2: Verify installation**

```bash
cd apps/mobile && pnpm ls @react-navigation/bottom-tabs @react-navigation/material-top-tabs
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/package.json apps/mobile/pnpm-lock.yaml
git commit -m "chore(mobile): add bottom-tabs and material-top-tabs dependencies"
```

---

### Task 2: Update Navigation Types

**Files:**
- Modify: `apps/mobile/src/navigation/types.ts`

Replace the entire file with:

```typescript
import type { NavigatorScreenParams } from "@react-navigation/native";
import type { SearchAlbumResult, SearchArtistResult } from "@/services/musicApi";
import type { BiliCollectionInfo } from "@/services/biliService";
import type { WyPlaylistInfo } from "@/services/wyPlaylistService";
import type { SearchFallbackDetailModel } from "@/services/searchFallbackDetailModel";
import type { SearchDetailRoute } from "@/services/searchDetailNavigation";

/** 底部 4 标签 */
export type MainTabParamList = {
  HomeTab: undefined;
  LibraryTab: undefined;
  MyMusicTab: undefined;
  SearchTab:
    | {
        initialKeyword?: string;
        initialDetailRoute?: SearchDetailRoute | null;
      }
    | undefined;
};

/** 曲库内部 TopTab */
export type LibraryTopTabParamList = {
  Playlists: undefined;
  Bili: undefined;
};

/** 我的内部 TopTab */
export type MyMusicTopTabParamList = {
  Local: undefined;
  History: undefined;
  Downloads: undefined;
};

/** 抽屉（保留但内容精简：账号 + 工具 + 设置） */
export type MainDrawerParamList = {
  MainTabs: undefined;
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

/** 根 Stack */
export type RootStackParamList = {
  Main: NavigatorScreenParams<MainDrawerParamList> | undefined;
  Player: undefined;
  DailyRecommend: undefined;
  PersonalFm: undefined;
  ArtistDetail: { artist: SearchArtistResult };
  AlbumDetail: { album: SearchAlbumResult; parentArtist?: SearchArtistResult | null };
  PlaylistDetail: { playlist: WyPlaylistInfo };
  LocalPlaylistDetail: { playlistId: string };
  BiliCollectionDetail: { collection: BiliCollectionInfo };
  LikedSongs: undefined;
  SearchFallbackDetail: { detail: SearchFallbackDetailModel };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
```

- [ ] **Step 1: Write the file**

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/navigation/types.ts
git commit -m "feat(mobile): restructure navigation types for bottom tabs"
```

---

### Task 3: Create MainTabNavigator

**Files:**
- Create: `apps/mobile/src/navigation/MainTabNavigator.tsx`

This file creates the 4-tab bottom navigator with nested TopTabs for Library and MyMusic. See the full implementation in the design doc Section 3.

Key structure:
- `MainTabNavigator` → 4 bottom tabs (HomeTab, LibraryTab, MyMusicTab, SearchTab)
- LibraryTab renders `LibraryTopTabs` (Playlists / Bili)
- MyMusicTab renders `MyMusicTopTabs` (Local / History / Downloads)
- Tab bar: height 56dp, icons from lucide-react-native, active tint = palette.primary

- [ ] **Step 1: Create the file**

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/navigation/MainTabNavigator.tsx
git commit -m "feat(mobile): create MainTabNavigator with 4 bottom tabs"
```

---

### Task 4: Rewrite MainDrawerNavigator

**Files:**
- Modify: `apps/mobile/src/navigation/MainDrawerNavigator.tsx`

Replace the current 9-screen drawer with a single-screen drawer wrapping MainTabNavigator:

```typescript
import React from "react";
import { useWindowDimensions } from "react-native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { DrawerContent } from "@/components/DrawerContent";
import { MainTabNavigator } from "@/navigation/MainTabNavigator";
import type { MainDrawerParamList } from "@/navigation/types";

const Drawer = createDrawerNavigator<MainDrawerParamList>();

export function MainDrawerNavigator() {
  const { width } = useWindowDimensions();
  const sidebarWidth = Math.min(300, Math.round(width * 0.78));

  return (
    <Drawer.Navigator
      initialRouteName="MainTabs"
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: "front",
        drawerStyle: { width: sidebarWidth },
        overlayColor: "rgba(0, 0, 0, 0.45)",
        swipeEnabled: true,
        swipeEdgeWidth: 24,
      }}
    >
      <Drawer.Screen name="MainTabs" component={MainTabNavigator} />
    </Drawer.Navigator>
  );
}
```

- [ ] **Step 1: Write the file**

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/navigation/MainDrawerNavigator.tsx
git commit -m "feat(mobile): rewrite MainDrawerNavigator to wrap BottomTabs"
```

---

### Task 5: Create DrawerContent

**Files:**
- Create: `apps/mobile/src/components/DrawerContent.tsx`

Slim drawer with: brand logo → account section (AccountInfo) → tools section (自定义音源 / WebDAV同步 / 数据管理 / 设置 / 关于) → version footer. Uses same styling patterns as old AppSidebar but much simpler.

- [ ] **Step 1: Create the file**

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/DrawerContent.tsx
git commit -m "feat(mobile): create slim DrawerContent with account/tools/settings"
```

---

### Task 6: Update RootNavigator and navigationRef

**Files:**
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/navigation/navigationRef.ts`

Add `DailyRecommend` and `PersonalFm` as RootStack screens (moved from drawer). Add `openPersonalFmScreen` helper.

- [ ] **Step 1: Update RootNavigator — add Daily/Fm screens, remove old drawer screen imports**

- [ ] **Step 2: Update navigationRef — add openPersonalFmScreen, fix openDailyRecommendScreen**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/navigation/RootNavigator.tsx apps/mobile/src/navigation/navigationRef.ts
git commit -m "feat(mobile): add Daily/Fm as root stack screens, update navigation helpers"
```

---

### Task 7: Update AppShell and AppHeader

**Files:**
- Modify: `apps/mobile/src/components/AppShell.tsx`
- Modify: `apps/mobile/src/components/AppHeader.tsx`

AppShell: Remove drawer state tracking (findOpenDrawerKey, findMainDrawerKey, hasNestedSettingsDetail, openDrawer). Keep header + content + player bar shell.

AppHeader: Remove `canGoForward` / `onGoForward` props and ChevronRight button. Keep hamburger (Menu), back, search, theme toggle.

- [ ] **Step 1: Simplify AppShell**

- [ ] **Step 2: Remove forward button from AppHeader**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/AppShell.tsx apps/mobile/src/components/AppHeader.tsx
git commit -m "feat(mobile): simplify AppShell and AppHeader, remove forward button"
```

---

### Task 8: Simplify PlayerBar

**Files:**
- Modify: `apps/mobile/src/components/PlayerBar.tsx`

Current: progress + (track + playMode + prev + play + next + addToList + lyrics + sleepTimer + expand + volume + volumeSlider) + timeRow

New: progress + (track + like + play + next + more) with `⋯` menu containing all secondary actions.

- [ ] **Step 1: Refactor to single row layout**

- [ ] **Step 2: Add more menu (Modal/action sheet) with secondary actions**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/PlayerBar.tsx
git commit -m "feat(mobile): simplify PlayerBar to single row with more menu"
```

---

### Task 9: Create MyMusicScreen

**Files:**
- Create: `apps/mobile/src/screens/MyMusicScreen.tsx`

Account card at top + content based on `tab` prop (local/history/downloads). Reuses existing SongList, DownloadList, EmptyState components.

- [ ] **Step 1: Create MyMusicScreen**

- [ ] **Step 2: Wire into MainTabNavigator's MyMusicTopTabs**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/MyMusicScreen.tsx
git commit -m "feat(mobile): create MyMusicScreen with account card and content tabs"
```

---

### Task 10: Update LibraryScreen for TopTab

**Files:**
- Modify: `apps/mobile/src/screens/LibraryScreen.tsx`

Change props from `activeSection/onSelectSection` to `tab: "playlists" | "bili"`. When tab=playlists show playlists content; when tab=bili show B站 collections.

- [ ] **Step 1: Refactor LibraryScreen props**

- [ ] **Step 2: Update MainTabNavigator to pass tab prop**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/LibraryScreen.tsx
git commit -m "feat(mobile): refactor LibraryScreen for TopTab split"
```

---

### Task 11: Update Navigation Models

**Files:**
- Modify: `apps/mobile/src/services/appNavigation.ts`
- Modify: `apps/mobile/src/navigation/drawerRouteModel.ts`
- Delete: `apps/mobile/src/components/AppSidebar.tsx`

Update AppTabId/VisibleTabId for new 4-tab structure. Simplify drawerRouteModel. Delete old AppSidebar (replaced by DrawerContent).

- [ ] **Step 1: Update appNavigation.ts**

- [ ] **Step 2: Simplify drawerRouteModel.ts**

- [ ] **Step 3: Delete AppSidebar.tsx**

- [ ] **Step 4: Fix all remaining imports referencing old types**

- [ ] **Step 5: Commit**

```bash
git add -A apps/mobile/src/
git commit -m "feat(mobile): update navigation models, delete old AppSidebar"
```

---

### Task 12: Tighten HomeScreen Spacing

**Files:**
- Modify: `apps/mobile/src/screens/HomeScreen.tsx`

Changes: hero.padding 24→16, hero.gap 18→12, heroTitle.fontSize display(24)→heading(18), container.gap 28→20, grid.gap 14→12.

- [ ] **Step 1: Update spacing values**

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/screens/HomeScreen.tsx
git commit -m "feat(mobile): tighten HomeScreen spacing for small screens"
```

---

### Task 13: Add playerBarHeight Token

**Files:**
- Modify: `apps/mobile/src/theme/tokens.ts`

Add `playerBarHeight: 56` to layout object.

- [ ] **Step 1: Add token**

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/theme/tokens.ts
git commit -m "feat(mobile): add playerBarHeight token"
```

---

### Task 14: Typecheck and Test

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

- [ ] **Step 2: Run tests**

```bash
cd apps/mobile && pnpm test
```

- [ ] **Step 3: Fix any errors**

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix(mobile): resolve typecheck and test errors from navigation redesign"
```

---

### Task 15: Android Integration Test

Manual verification checklist on Android device/emulator:

**Navigation:**
- [ ] Bottom 4 tabs visible, switching works
- [ ] Hamburger opens slim drawer
- [ ] Right-edge swipe opens drawer
- [ ] Search tab shows search with suggestions

**PlayerBar:**
- [ ] Single row, height <= 56dp
- [ ] All buttons tappable (>= 44dp)
- [ ] More menu opens with secondary actions
- [ ] Progress bar seekable

**Library Tab:**
- [ ] TopTab: 歌单 / B站 switching works

**MyMusic Tab:**
- [ ] Account card visible
- [ ] TopTab: 本地 / 历史 / 下载 switching works
- [ ] Local FAB scan works

**Home:**
- [ ] Hero compact, recent plays visible on first screen
- [ ] FM and search buttons work

**Immersive Player:**
- [ ] Opens from PlayerBar
- [ ] Controls auto-hide after 3s
- [ ] Tap to restore

- [ ] **Step 1: Build and test**

```bash
cd apps/mobile && pnpm android:assembleDebug
```

- [ ] **Step 2: Fix any issues**

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(mobile): complete UI/UX redesign - bottom tabs + slim drawer + player bar"
```
