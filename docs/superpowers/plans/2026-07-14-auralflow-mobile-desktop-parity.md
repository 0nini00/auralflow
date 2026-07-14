# AuralFlow Mobile Desktop Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the React Native application match the desktop application's shell, navigation, visual language, and business capabilities, with a default-hidden mobile drawer and explicit Android-native equivalents for desktop-only system features.

**Architecture:** Keep React Navigation, Zustand, Track Player, and Android services as the mobile runtime. Replace the current inline shell, duplicate detail navigation, absolute MiniPlayer, per-screen bottom compensation, and glyph icons with one `AppShell`, one Root Stack, one complete `PlayerBar`, shared screen scaffolding, and Lucide-based visual primitives.

**Tech Stack:** React Native 0.86, React 19, TypeScript 5.8, React Navigation 7, Zustand 5, react-native-track-player 4.1, lucide-react-native, Vitest 2.

## Global Constraints

- The drawer is the only structural mobile navigation difference: it uses `drawerType: "front"` and is closed on cold start.
- Responsive logic may change wrapping, size, spacing, safe-area treatment, and column count; it may not hide business capabilities.
- Desktop-only tray, global shortcut, floating desktop lyric window, and Tauri filesystem features use explicit Android-native equivalents.
- All icon-only touch targets are at least `44 x 44` and have accessibility labels.
- Do not add Emoji, transport glyphs, text arrows, or an `AF` text block as UI icons.
- React Navigation remains the active-route truth; Header history stores only derived replay descriptors.
- `playerStore` remains the player and sleep-timer truth; do not use the unused `sleepTimerStore.ts`.
- All production changes follow Red-Green-Refactor. A test must fail for the expected missing behavior before implementation.
- The current workspace contains an uncommitted directory migration in which `apps/mobile` is untracked. Do not create implementation commits that would partially claim the user's migration. Keep task changes unstaged and verify them by exact file list until the migration has an owner-approved baseline commit.
- Backend test commands are not introduced by this plan. All Vitest commands below must complete within 60 seconds.

---

## File Structure

### New files

- `apps/mobile/src/services/appShellModel.ts`: derives active route and chrome visibility from React Navigation state.
- `apps/mobile/src/services/appShellModel.test.ts`: behavior tests for shell navigation derivation.
- `apps/mobile/src/navigation/navigationHistoryModel.ts`: pure backward/forward descriptor history.
- `apps/mobile/src/navigation/navigationHistoryModel.test.ts`: behavior tests for history recording and replay.
- `apps/mobile/src/navigation/drawerRouteModel.ts`: single drawer route/tab mapping.
- `apps/mobile/src/navigation/drawerRouteModel.test.ts`: exhaustive mapping tests.
- `apps/mobile/src/components/AppShell.tsx`: Header, content surface, and PlayerBar composition.
- `apps/mobile/src/components/AppHeader.tsx`: menu, backward, forward, search, and theme actions.
- `apps/mobile/src/components/PlayerBar.tsx`: complete shell-level player controls.
- `apps/mobile/src/components/ScreenScaffold.tsx`: shared screen surface and scroll container.
- `apps/mobile/src/components/SectionHeader.tsx`: desktop-aligned section title/action primitive.
- `apps/mobile/src/components/DetailHero.tsx`: shared detail cover/title/metadata primitive.
- `apps/mobile/src/components/ScreenState.tsx`: loading, error, and empty-state primitives.
- `apps/mobile/src/assets/logo.png`: copy of `desktop/src/assets/logo.png`.
- `apps/mobile/src/services/__tests__/appShellIntegration.test.ts`: shell wiring contract.
- `apps/mobile/src/services/__tests__/appHeaderIntegration.test.ts`: Header wiring and accessibility contract.
- `apps/mobile/src/services/__tests__/appSidebarIntegration.test.ts`: drawer order and logo contract.
- `apps/mobile/src/services/__tests__/playerBarIntegration.test.ts`: complete PlayerBar feature contract.
- `apps/mobile/src/services/__tests__/screenScaffoldIntegration.test.ts`: screen migration and magic-padding contract.
- `apps/mobile/src/services/__tests__/mobileIconAudit.test.ts`: forbidden glyph and touch-label audit.

### Removed files

- `apps/mobile/App.new.tsx`: stale alternate entry included by TypeScript.
- `apps/mobile/src/components/MobileHeader.tsx`: replaced by `AppHeader.tsx`.
- `apps/mobile/src/components/MiniPlayer.tsx`: replaced by `PlayerBar.tsx`.
- `apps/mobile/src/screens/PlayerScreen.tsx`: unused second player screen; Root `Player` already uses `ImmersiveLyricsScreen`.
- `apps/mobile/src/stores/sleepTimerStore.ts`: unused second sleep-timer truth.
- `apps/mobile/src/services/libraryNavigation.ts`: duplicate detail-state model removed after Root Stack migration.
- `apps/mobile/src/services/__tests__/miniPlayerNavigationIntegration.test.ts`: replaced by PlayerBar coverage.
- `apps/mobile/src/services/__tests__/miniPlayerProgressIntegration.test.ts`: replaced by PlayerBar coverage.

### Modified files

- `apps/mobile/App.tsx`
- `apps/mobile/src/components/AppSidebar.tsx`
- `apps/mobile/src/components/ActionMenuSheet.tsx`
- `apps/mobile/src/components/MusicCard.tsx`
- `apps/mobile/src/components/SongList.tsx`
- `apps/mobile/src/navigation/MainDrawerNavigator.tsx`
- `apps/mobile/src/navigation/RootNavigator.tsx`
- `apps/mobile/src/navigation/index.ts`
- `apps/mobile/src/navigation/navigationRef.ts`
- `apps/mobile/src/navigation/types.ts`
- `apps/mobile/src/services/__tests__/libraryNavigation.test.ts`
- `apps/mobile/src/screens/HomeScreen.tsx`
- `apps/mobile/src/screens/SearchScreen.tsx`
- `apps/mobile/src/screens/DailyRecommendScreen.tsx`
- `apps/mobile/src/screens/PersonalFmScreen.tsx`
- `apps/mobile/src/screens/LibraryScreen.tsx`
- `apps/mobile/src/screens/DownloadScreen.tsx`
- `apps/mobile/src/screens/SettingsScreen.tsx`
- `apps/mobile/src/screens/ArtistDetailScreen.tsx`
- `apps/mobile/src/screens/AlbumDetailScreen.tsx`
- `apps/mobile/src/screens/PlaylistDetailScreen.tsx`
- `apps/mobile/src/screens/LocalPlaylistDetailScreen.tsx`
- `apps/mobile/src/screens/BiliCollectionDetailScreen.tsx`
- `apps/mobile/src/screens/LikedSongsScreen.tsx`
- `apps/mobile/src/screens/SearchFallbackDetailScreen.tsx`
- `apps/mobile/src/screens/CustomSourceScreen.tsx`
- `apps/mobile/src/screens/LyricSettingsScreen.tsx`
- `apps/mobile/src/screens/immersive/ImmersiveTransport.tsx`
- `apps/mobile/src/theme/tokens.ts`

---

### Task 1: Shell state models and drawer mapping

**Files:**
- Create: `apps/mobile/src/services/appShellModel.ts`
- Create: `apps/mobile/src/services/appShellModel.test.ts`
- Create: `apps/mobile/src/navigation/drawerRouteModel.ts`
- Create: `apps/mobile/src/navigation/drawerRouteModel.test.ts`
- Modify: `apps/mobile/src/navigation/MainDrawerNavigator.tsx`

**Interfaces:**
- Produces: `getActiveRouteName(state)`, `deriveAppShellNavigationState(state)`, `drawerRouteToTabId(route)`, and `tabIdToDrawerRoute(id)`.
- Consumes: `MainDrawerParamList`, `VisibleTabId`, `APP_TABS`, and `APP_SETTINGS_TAB`.

- [ ] **Step 1: Write failing shell model tests**

```ts
import { describe, expect, it } from "vitest";
import { deriveAppShellNavigationState } from "./appShellModel";

describe("app shell model", () => {
  it("reads the active nested drawer route", () => {
    const state = {
      index: 0,
      routes: [{ name: "Main", state: { index: 1, routes: [{ name: "Home" }, { name: "Search" }] } }],
    };

    expect(deriveAppShellNavigationState(state as never)).toEqual({
      activeRouteName: "Search",
      canGoBack: false,
      showChrome: true,
    });
  });

  it("shows back navigation on root details", () => {
    const state = { index: 1, routes: [{ name: "Main" }, { name: "ArtistDetail" }] };
    expect(deriveAppShellNavigationState(state as never)).toMatchObject({
      activeRouteName: "ArtistDetail",
      canGoBack: true,
      showChrome: true,
    });
  });

  it("hides shell chrome for the immersive player", () => {
    const state = { index: 1, routes: [{ name: "Main" }, { name: "Player" }] };
    expect(deriveAppShellNavigationState(state as never).showChrome).toBe(false);
  });
});
```

- [ ] **Step 2: Run the shell test and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/appShellModel.test.ts
```

Expected: FAIL because `appShellModel.ts` does not exist.

- [ ] **Step 3: Implement the shell model**

```ts
import type { NavigationState, PartialState } from "@react-navigation/native";

type AnyNavigationState = NavigationState | PartialState<NavigationState>;

export interface AppShellNavigationState {
  activeRouteName?: string;
  canGoBack: boolean;
  showChrome: boolean;
}

export function getActiveRouteName(state?: AnyNavigationState): string | undefined {
  if (!state || state.routes.length === 0) return undefined;
  const route = state.routes[state.index ?? 0];
  const nested = route.state as AnyNavigationState | undefined;
  return getActiveRouteName(nested) ?? route.name;
}

export function deriveAppShellNavigationState(
  state?: AnyNavigationState,
): AppShellNavigationState {
  const activeRouteName = getActiveRouteName(state);
  return {
    activeRouteName,
    canGoBack: (state?.index ?? 0) > 0,
    showChrome: activeRouteName !== "Player",
  };
}
```

- [ ] **Step 4: Write failing exhaustive drawer mapping tests**

```ts
import { describe, expect, it } from "vitest";
import { APP_SETTINGS_TAB, APP_TABS } from "@/services/appNavigation";
import { drawerRouteToTabId, tabIdToDrawerRoute } from "./drawerRouteModel";

describe("drawer route model", () => {
  it.each([
    ["home", "Home"],
    ["search", "Search"],
    ["daily", "Daily"],
    ["fm", "FM"],
    ["playlists", "Playlists"],
    ["downloads", "Downloads"],
    ["local", "Local"],
    ["settings", "Settings"],
  ] as const)("maps %s to %s in both directions", (tab, route) => {
    expect(tabIdToDrawerRoute(tab)).toBe(route);
    expect(drawerRouteToTabId(route)).toBe(tab);
  });

  it("covers every visible sidebar item", () => {
    const ids = [...APP_TABS, APP_SETTINGS_TAB].map((item) => item.id);
    expect(ids.map(tabIdToDrawerRoute)).toHaveLength(ids.length);
  });

  it("maps the legacy Library route to playlists without exposing a second tab", () => {
    expect(drawerRouteToTabId("Library")).toBe("playlists");
  });
});
```

- [ ] **Step 5: Run the drawer test and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/navigation/drawerRouteModel.test.ts
```

Expected: FAIL because `drawerRouteModel.ts` does not exist.

- [ ] **Step 6: Implement and wire the drawer route model**

```ts
import type { MainDrawerParamList } from "@/navigation/types";
import type { VisibleTabId } from "@/services/appNavigation";

const TAB_TO_ROUTE: Record<VisibleTabId, keyof MainDrawerParamList> = {
  home: "Home",
  search: "Search",
  daily: "Daily",
  fm: "FM",
  playlists: "Playlists",
  downloads: "Downloads",
  local: "Local",
  settings: "Settings",
};

export function tabIdToDrawerRoute(id: VisibleTabId): keyof MainDrawerParamList {
  return TAB_TO_ROUTE[id];
}

export function drawerRouteToTabId(route: keyof MainDrawerParamList): VisibleTabId {
  if (route === "Library") return "playlists";
  const match = Object.entries(TAB_TO_ROUTE).find(([, value]) => value === route);
  if (!match) throw new Error(`Unknown drawer route: ${route}`);
  return match[0] as VisibleTabId;
}
```

Modify `MainDrawerNavigator.tsx` to import these functions, delete both private switch statements, and close before navigation:

```ts
onSelect={(id) => {
  props.navigation.closeDrawer();
  props.navigation.navigate(tabIdToDrawerRoute(id));
}}
```

- [ ] **Step 7: Run Task 1 tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/appShellModel.test.ts src/navigation/drawerRouteModel.test.ts src/services/__tests__/appNavigation.test.ts
pnpm mobile:typecheck
```

Expected: all selected tests pass and TypeScript exits `0`.

- [ ] **Step 8: Record the task checkpoint without staging user migration files**

Run:

```powershell
git status --short -- apps/mobile/src/services/appShellModel.ts apps/mobile/src/services/appShellModel.test.ts apps/mobile/src/navigation/drawerRouteModel.ts apps/mobile/src/navigation/drawerRouteModel.test.ts apps/mobile/src/navigation/MainDrawerNavigator.tsx
```

Expected: only the five Task 1 paths are listed for this checkpoint review.

---

### Task 2: Derived navigation history and unified AppShell

**Files:**
- Create: `apps/mobile/src/navigation/navigationHistoryModel.ts`
- Create: `apps/mobile/src/navigation/navigationHistoryModel.test.ts`
- Create: `apps/mobile/src/components/AppShell.tsx`
- Create: `apps/mobile/src/components/AppHeader.tsx`
- Create: `apps/mobile/src/services/__tests__/appShellIntegration.test.ts`
- Modify: `apps/mobile/App.tsx`
- Remove: `apps/mobile/App.new.tsx`
- Remove: `apps/mobile/src/components/MobileHeader.tsx`

**Interfaces:**
- Consumes: `deriveAppShellNavigationState`, `navigationRef`, `openPlayerScreen`, theme store, and search query store.
- Produces: `NavigationHistory<T>`, `recordNavigation`, `moveBackward`, `moveForward`, and `AppShell({ children })`.

- [ ] **Step 1: Write failing history behavior tests**

```ts
import { describe, expect, it } from "vitest";
import {
  createNavigationHistory,
  moveBackward,
  moveForward,
  recordNavigation,
} from "./navigationHistoryModel";

describe("navigation history model", () => {
  it("truncates forward entries after a new navigation", () => {
    let history = createNavigationHistory("Home");
    history = recordNavigation(history, "Search");
    history = recordNavigation(history, "ArtistDetail");
    history = moveBackward(history).history;
    history = recordNavigation(history, "Settings");
    expect(history).toEqual({ entries: ["Home", "Search", "Settings"], index: 2 });
  });

  it("moves backward and forward without duplicating entries", () => {
    let history = createNavigationHistory("Home");
    history = recordNavigation(history, "Search");
    const back = moveBackward(history);
    const forward = moveForward(back.history);
    expect(back.value).toBe("Home");
    expect(forward.value).toBe("Search");
  });
});
```

- [ ] **Step 2: Run history tests and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/navigation/navigationHistoryModel.test.ts
```

Expected: FAIL because the model does not exist.

- [ ] **Step 3: Implement the pure history model**

```ts
export interface NavigationHistory<T> {
  entries: T[];
  index: number;
}

export interface NavigationMove<T> {
  history: NavigationHistory<T>;
  value: T | null;
}

export function createNavigationHistory<T>(initial: T): NavigationHistory<T> {
  return { entries: [initial], index: 0 };
}

export function recordNavigation<T>(history: NavigationHistory<T>, value: T): NavigationHistory<T> {
  if (Object.is(history.entries[history.index], value)) return history;
  return { entries: [...history.entries.slice(0, history.index + 1), value], index: history.index + 1 };
}

export function moveBackward<T>(history: NavigationHistory<T>): NavigationMove<T> {
  if (history.index === 0) return { history, value: null };
  const index = history.index - 1;
  return { history: { ...history, index }, value: history.entries[index] };
}

export function moveForward<T>(history: NavigationHistory<T>): NavigationMove<T> {
  if (history.index >= history.entries.length - 1) return { history, value: null };
  const index = history.index + 1;
  return { history: { ...history, index }, value: history.entries[index] };
}
```

- [ ] **Step 4: Write the failing shell integration contract**

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  const absolutePath = resolve(process.cwd(), path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};

describe("app shell integration", () => {
  it("moves chrome composition out of App.tsx", () => {
    const app = read("App.tsx");
    expect(app).toContain('import { AppShell } from "@/components/AppShell"');
    expect(app).toContain("<AppShell>");
    expect(app).not.toContain("function AppChrome");
    expect(app).not.toContain("<MiniPlayer");
  });

  it("uses normal flow for header, content, and player", () => {
    const shell = read("src/components/AppShell.tsx");
    expect(shell.indexOf("<AppHeader")).toBeLessThan(shell.indexOf("styles.content"));
    expect(shell.indexOf("<PlayerBar")).toBeGreaterThan(shell.indexOf("styles.content"));
    expect(shell).not.toContain('position: "absolute"');
  });
});
```

- [ ] **Step 5: Run shell integration and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/appShellIntegration.test.ts
```

Expected: FAIL because `AppShell.tsx` is absent and App still defines `AppChrome`.

- [ ] **Step 6: Implement and wire `AppShell`**

Create `AppHeader.tsx` by moving the current search suggestion and theme logic from `MobileHeader.tsx`. Give it the final `AppHeaderProps` interface defined in Task 3, then remove `MobileHeader.tsx`. In `AppShell.tsx`, define this private controller interface and hook:

```ts
interface AppShellController {
  showChrome: boolean;
  statusBar: "default" | "light-content" | "dark-content";
  headerProps: AppHeaderProps;
}
```

The hook listens to `navigationRef` state changes, derives chrome state with `deriveAppShellNavigationState`, records semantic Root or Main Drawer route descriptors with `recordNavigation`, reconciles system-back transitions against adjacent history entries, and returns replay handlers through `headerProps`. A replay dispatches Root targets with `navigateRoot(name, params)` and Main targets with `navigateRoot("Main", { screen: name, params })`; React Navigation remains the active-route truth.

Use this public shell structure; Task 5 supplies the final `PlayerBar` implementation:

```tsx
export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const insets = useSafeAreaInsets();
  const shellState = useAppShellController();

  if (!shellState.showChrome) return <>{children}</>;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle={shellState.statusBar} />
      <AppBackground>
        <AppHeader {...shellState.headerProps} />
        <View style={styles.content}>{children}</View>
        <PlayerBar onOpen={openPlayerScreen} bottomInset={insets.bottom} />
      </AppBackground>
    </SafeAreaView>
  );
}
```

Move the existing theme, navigation-state listener, global search submission, drawer dispatch, and player-open wiring from `AppChrome` into the shell hook/component. In `App.tsx`, mount only:

```tsx
<NavigationContainer ref={navigationRef}>
  <AppShell>
    <RootNavigator />
  </AppShell>
</NavigationContainer>
```

Delete `App.new.tsx` after confirming `rg -n "App.new" apps/mobile` has no import.

- [ ] **Step 7: Run Task 2 tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/navigation/navigationHistoryModel.test.ts src/services/appShellModel.test.ts src/services/__tests__/appShellIntegration.test.ts src/services/__tests__/homeSearchEntryIntegration.test.ts src/services/__tests__/mobileDeepLinkIntegration.test.ts
pnpm mobile:typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

---

### Task 3: Desktop-aligned Header and Sidebar

**Files:**
- Modify: `apps/mobile/src/components/AppHeader.tsx`
- Create: `apps/mobile/src/services/__tests__/appHeaderIntegration.test.ts`
- Create: `apps/mobile/src/services/__tests__/appSidebarIntegration.test.ts`
- Create: `apps/mobile/src/assets/logo.png`
- Modify: `apps/mobile/src/components/AppShell.tsx`
- Modify: `apps/mobile/src/components/AppSidebar.tsx`
- Modify: `apps/mobile/src/theme/tokens.ts`

**Interfaces:**
- Produces: `AppHeaderProps` with menu, back, forward, search, and theme actions.
- Consumes: shell history controls, search suggestion service, and theme store.

- [ ] **Step 1: Write failing Header and Sidebar integration tests**

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  const absolutePath = resolve(process.cwd(), path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};

describe("app header integration", () => {
  it("renders menu, back, and forward together", () => {
    const source = read("src/components/AppHeader.tsx");
    expect(source).toContain("Menu");
    expect(source).toContain("ChevronLeft");
    expect(source).toContain("ChevronRight");
    expect(source).toContain('accessibilityLabel="打开菜单"');
    expect(source).toContain('accessibilityLabel="后退"');
    expect(source).toContain('accessibilityLabel="前进"');
    expect(source).not.toContain("leftAction");
  });

  it("uses the minimum touch target", () => {
    const source = read("src/components/AppHeader.tsx");
    expect(source).toContain("minWidth: touch.minTarget");
    expect(source).toContain("minHeight: touch.minTarget");
  });
});

describe("app sidebar integration", () => {
  it("uses the real logo and closes before navigation", () => {
    const sidebar = read("src/components/AppSidebar.tsx");
    const drawer = read("src/navigation/MainDrawerNavigator.tsx");
    expect(sidebar).toContain("<Image");
    expect(sidebar).toContain('require("../assets/logo.png")');
    expect(sidebar).not.toContain(">AF</Text>");
    expect(drawer.indexOf("closeDrawer()")).toBeLessThan(drawer.indexOf("navigate(tabIdToDrawerRoute(id))"));
  });
});
```

- [ ] **Step 2: Run integration tests and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/appHeaderIntegration.test.ts src/services/__tests__/appSidebarIntegration.test.ts
```

Expected: FAIL because `AppHeader.tsx` and the mobile logo are absent.

- [ ] **Step 3: Harden `AppHeader` and wire history actions**

```ts
export interface AppHeaderProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onOpenDrawer: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onSubmitSearch: (keyword: string) => void;
  seedQuery?: string;
}
```

Render three independent `Touchable` buttons before the search field:

```tsx
<View style={styles.navigationActions}>
  <Touchable onPress={onOpenDrawer} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="打开菜单">
    <Menu size={20} color={palette.text} />
  </Touchable>
  <Touchable disabled={!canGoBack} onPress={onGoBack} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="后退">
    <ChevronLeft size={20} color={canGoBack ? palette.text : palette.textSubtle} />
  </Touchable>
  <Touchable disabled={!canGoForward} onPress={onGoForward} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="前进">
    <ChevronRight size={20} color={canGoForward ? palette.text : palette.textSubtle} />
  </Touchable>
</View>
```

Use `touch.minTarget` for `minWidth` and `minHeight`. Preserve the debounced suggestions, submit behavior, and theme toggle moved into `AppHeader.tsx` in Task 2. Update `AppShell.tsx` so `canGoBack`, `canGoForward`, `onGoBack`, and `onGoForward` come from the history controller rather than component-local route guesses.

- [ ] **Step 4: Copy and render the desktop logo**

Copy `desktop/src/assets/logo.png` byte-for-byte to `apps/mobile/src/assets/logo.png`. Replace the text logo mark with:

```tsx
<Image source={require("../assets/logo.png")} style={styles.logoImage} accessibilityLabel="AuralFlow" />
```

Keep `APP_TABS` and `APP_SETTINGS_TAB` as the only navigation item source.

- [ ] **Step 5: Run Task 3 tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/appHeaderIntegration.test.ts src/services/__tests__/appSidebarIntegration.test.ts src/services/__tests__/searchSuggestionIntegration.test.ts
pnpm mobile:typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

---

### Task 4: Root Stack as the only detail navigation source

**Files:**
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/navigationRef.ts`
- Modify: `apps/mobile/src/navigation/index.ts`
- Modify: `apps/mobile/src/screens/LibraryScreen.tsx`
- Modify: `apps/mobile/src/services/__tests__/libraryNavigation.test.ts` to become Root integration coverage.
- Remove: `apps/mobile/src/services/libraryNavigation.ts`

**Interfaces:**
- Consumes: existing `openPlaylistDetailScreen`, `openLocalPlaylistDetailScreen`, `openBiliCollectionDetailScreen`, `openLikedSongsScreen`, and `openDailyRecommendScreen` helpers.
- Produces: no new route store; Library emits Root navigation actions only.

- [ ] **Step 1: Write the failing Root navigation integration test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/screens/LibraryScreen.tsx"), "utf8");

describe("library root navigation integration", () => {
  it("does not render detail screens from local sub-route state", () => {
    expect(source).not.toContain("subRoute");
    expect(source).not.toContain("setSubRoute");
    expect(source).not.toContain("<PlaylistDetailScreen");
    expect(source).not.toContain("<LocalPlaylistDetailScreen");
    expect(source).not.toContain("<BiliCollectionDetailScreen");
    expect(source).not.toContain("<LikedSongsScreen");
  });

  it("opens every detail through Root navigation helpers", () => {
    expect(source).toContain("openPlaylistDetailScreen");
    expect(source).toContain("openLocalPlaylistDetailScreen");
    expect(source).toContain("openBiliCollectionDetailScreen");
    expect(source).toContain("openLikedSongsScreen");
    expect(source).toContain("openDailyRecommendScreen");
  });
});
```

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/libraryNavigation.test.ts
```

Expected: FAIL because Library still contains `subRoute` and inline detail screens.

- [ ] **Step 3: Remove the duplicate detail state**

Delete `subRoute`, `setSubRoute`, detail screen imports, and the conditional detail return block from `LibraryScreen.tsx`. Replace callbacks with the existing Root helpers:

```tsx
onOpenPlaylist={openPlaylistDetailScreen}
onOpenLocalPlaylist={openLocalPlaylistDetailScreen}
onOpenBiliCollection={openBiliCollectionDetailScreen}
onOpenLikedSongs={openLikedSongsScreen}
onOpenDaily={openDailyRecommendScreen}
```

Remove the duplicate Root `Download` route and `openDownloadScreen`; the Drawer `Downloads` route is the only download-page entry. Update every caller to navigate to `Main` with `{ screen: "Downloads" }`.

- [ ] **Step 4: Remove obsolete navigation files and verify references**

Run:

```powershell
rg -n "libraryNavigation|subRoute|openDownloadScreen|name=\"Download\"" apps/mobile/src apps/mobile/App.tsx
```

Expected: no matches for removed symbols; remaining `subRoute` matches outside Library must be reviewed and must not render the same Root detail screens.

- [ ] **Step 5: Run navigation regressions and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/libraryNavigation.test.ts src/services/__tests__/mobileDeepLinkIntegration.test.ts src/services/__tests__/homeSearchEntryIntegration.test.ts src/navigation/drawerRouteModel.test.ts
pnpm mobile:typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

---

### Task 5: Complete shell-level PlayerBar and remove duplicate player state

**Files:**
- Create: `apps/mobile/src/components/PlayerBar.tsx`
- Create: `apps/mobile/src/services/__tests__/playerBarIntegration.test.ts`
- Modify: `apps/mobile/src/components/AppShell.tsx`
- Remove: `apps/mobile/src/components/MiniPlayer.tsx`
- Remove: `apps/mobile/src/screens/PlayerScreen.tsx`
- Remove: `apps/mobile/src/stores/sleepTimerStore.ts`
- Remove: `apps/mobile/src/services/__tests__/miniPlayerNavigationIntegration.test.ts`
- Remove: `apps/mobile/src/services/__tests__/miniPlayerProgressIntegration.test.ts`

**Interfaces:**
- Consumes: `playerStore`, `playerService`, `playlistStore`, `ProgressBar`, `AddToLocalPlaylistModal`, `lyricOverlayStore`, and the existing Root `Player` route.
- Produces: `PlayerBar({ onOpen, bottomInset? })` with the complete desktop control set.

- [ ] **Step 1: Write the failing PlayerBar feature contract**

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const playerBarPath = resolve(process.cwd(), "src/components/PlayerBar.tsx");
const source = existsSync(playerBarPath) ? readFileSync(playerBarPath, "utf8") : "";

describe("player bar integration", () => {
  it("exposes the desktop player capability set on every width", () => {
    for (const token of [
      "seekTo",
      "formatTime(position)",
      "formatTime(duration)",
      "togglePlayMode",
      "playPrevious",
      "playNext",
      "toggleMute",
      "setVolume",
      "startSleepTimer",
      "startSongSleepTimer",
      "cancelSleepTimer",
      "AddToLocalPlaylistModal",
    ]) expect(source).toContain(token);
    expect(source).not.toContain("isTablet ?");
  });

  it("uses Lucide controls and accessible touch targets", () => {
    for (const label of ["播放模式", "上一首", "播放", "暂停", "下一首", "静音", "歌词", "定时关闭"])
      expect(source).toContain(`accessibilityLabel="${label}`);
    expect(source).not.toMatch(/[\u{1F500}\u{1F502}\u{1F501}\u{1F507}\u{1F50A}\u{23EE}\u{23ED}\u{23F8}\u{25B6}]/u);
  });
});
```

- [ ] **Step 2: Run the PlayerBar contract and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/playerBarIntegration.test.ts
```

Expected: FAIL because `PlayerBar.tsx` does not exist.

- [ ] **Step 3: Implement PlayerBar from existing player truth**

Keep the external API minimal:

```ts
export interface PlayerBarProps {
  onOpen: () => void;
  bottomInset?: number;
}
```

Subscribe directly to `usePlayerStore` for current song, state, progress, mode, volume, mute, and sleep timer. Render this stable hierarchy for all widths:

```tsx
<View style={[styles.root, { paddingBottom: bottomInset }]}>
  <ProgressBar position={position} duration={duration} onSeek={seekTo} />
  <View style={styles.content}>
    <Touchable onPress={onOpen} style={styles.trackSummary} accessibilityRole="button" accessibilityLabel="打开沉浸式播放器">
      <CachedImage uri={coverUrl} style={styles.cover} />
      <View style={styles.trackText}>
        <Text style={styles.trackName} numberOfLines={1}>{currentSong.name}</Text>
        <Text style={styles.trackArtist} numberOfLines={1}>{currentSong.singer}</Text>
      </View>
    </Touchable>
    <View style={styles.transportControls}>{/* mode, previous, toggle, next */}</View>
    <View style={styles.utilityControls}>{/* add, lyrics, sleep, mute, volume */}</View>
  </View>
  <View style={styles.timeRow}>
    <Text>{formatTime(position)}</Text>
    <Text>{formatTime(duration)}</Text>
  </View>
  <AddToLocalPlaylistModal visible={addModalOpen} song={currentSong} onClose={closeAddModal} />
</View>
```

Use `flexWrap: "wrap"` and width-aware spacing only; do not conditionally remove a control for phones. Open Root `Player` for the lyrics/immersive equivalent. Use only `playerStore` sleep actions.

- [ ] **Step 4: Delete duplicate player implementations**

Confirm production Root `Player` renders `ImmersiveLyricsScreen`, then delete `PlayerScreen.tsx`, `sleepTimerStore.ts`, `MiniPlayer.tsx`, and the two MiniPlayer source-contract tests. Update AppShell imports to `PlayerBar`.

- [ ] **Step 5: Run player regressions and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/playerBarIntegration.test.ts src/services/__tests__/mobilePlayModeModel.test.ts src/services/__tests__/playerVolumeModel.test.ts src/services/__tests__/songSleepTimerModel.test.ts src/stores/playerStore.test.ts
pnpm mobile:typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

---

### Task 6: ScreenScaffold and main-screen migration

**Files:**
- Create: `apps/mobile/src/components/ScreenScaffold.tsx`
- Create: `apps/mobile/src/components/SectionHeader.tsx`
- Create: `apps/mobile/src/components/ScreenState.tsx`
- Create: `apps/mobile/src/services/__tests__/screenScaffoldIntegration.test.ts`
- Modify: `apps/mobile/src/screens/HomeScreen.tsx`
- Modify: `apps/mobile/src/screens/SearchScreen.tsx`
- Modify: `apps/mobile/src/screens/DailyRecommendScreen.tsx`
- Modify: `apps/mobile/src/screens/PersonalFmScreen.tsx`
- Modify: `apps/mobile/src/screens/LibraryScreen.tsx`
- Modify: `apps/mobile/src/screens/DownloadScreen.tsx`
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx`

**Interfaces:**
- Produces: `ScreenScaffold`, `ScreenScrollView`, `SectionHeader`, `LoadingState`, `ErrorState`, and `EmptyState`.
- Consumes: palette, spacing, radius, typography, and the existing screen content.

- [ ] **Step 1: Write the failing scaffold migration contract**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const screens = [
  "HomeScreen.tsx",
  "SearchScreen.tsx",
  "DailyRecommendScreen.tsx",
  "PersonalFmScreen.tsx",
  "LibraryScreen.tsx",
  "DownloadScreen.tsx",
  "SettingsScreen.tsx",
];

describe("main screen scaffold integration", () => {
  it.each(screens)("migrates %s to the shared scaffold", (name) => {
    const source = readFileSync(resolve(process.cwd(), "src/screens", name), "utf8");
    expect(source).toContain("ScreenScaffold");
    expect(source).not.toMatch(/paddingBottom:\s*(100|120)/);
  });
});
```

- [ ] **Step 2: Run scaffold contract and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/screenScaffoldIntegration.test.ts
```

Expected: FAIL because the scaffold is absent and all listed screens contain magic bottom padding.

- [ ] **Step 3: Implement shared scaffold and state primitives**

```tsx
export function ScreenScaffold({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

export function ScreenScrollView({ contentContainerStyle, ...props }: ScrollViewProps) {
  return (
    <ScrollView
      {...props}
      style={[styles.scroll, props.style]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
    />
  );
}
```

`styles.surface` uses `flex: 1`, transparent background, shared radius and border. `styles.content` uses desktop-aligned page padding from tokens and contains no PlayerBar height.

Implement state primitives with explicit props:

```ts
export interface ErrorStateProps { message: string; onRetry?: () => void }
export interface EmptyStateProps { title: string; description?: string }
export interface LoadingStateProps { label?: string }
```

- [ ] **Step 4: Migrate the seven main screens**

For ScrollView pages, use:

```tsx
return (
  <ScreenScaffold>
    <ScreenScrollView refreshControl={refreshControl}>
      {content}
    </ScreenScrollView>
  </ScreenScaffold>
);
```

For FlatList/SectionList pages, use one list inside `ScreenScaffold` and move shared padding into `contentContainerStyle`. In every listed file:

- remove `paddingBottom: 100` or `120`;
- remove opaque page-root background that masks `AppBackground`;
- replace duplicate title/action rows with `SectionHeader`;
- replace page-level spinner/error/empty blocks with `LoadingState`, `ErrorState`, or `EmptyState` without changing service behavior.

- [ ] **Step 5: Run main-screen tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/screenScaffoldIntegration.test.ts src/services/__tests__/homeSearchEntryIntegration.test.ts src/services/__tests__/dailyRecommendMetaIntegration.test.ts src/services/__tests__/personalFmMetaIntegration.test.ts src/services/__tests__/libraryContentModel.test.ts src/services/__tests__/downloadListMetadataModel.test.ts src/services/__tests__/settingsVersionIntegration.test.ts
pnpm mobile:typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

---

### Task 7: Detail and special-screen migration

**Files:**
- Create: `apps/mobile/src/components/DetailHero.tsx`
- Modify: `apps/mobile/src/screens/ArtistDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/AlbumDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/PlaylistDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/LocalPlaylistDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/BiliCollectionDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/LikedSongsScreen.tsx`
- Modify: `apps/mobile/src/screens/SearchFallbackDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/CustomSourceScreen.tsx`
- Modify: `apps/mobile/src/screens/LyricSettingsScreen.tsx`
- Extend: `apps/mobile/src/services/__tests__/screenScaffoldIntegration.test.ts`

**Interfaces:**
- Consumes: `ScreenScaffold`, `ScreenScrollView`, `DetailHero`, shared states, and Root Header navigation.
- Produces: detail pages without private back bars or player compensation.

- [ ] **Step 1: Extend the failing migration contract to detail screens**

Add these files to the test matrix:

```ts
const detailScreens = [
  "ArtistDetailScreen.tsx",
  "AlbumDetailScreen.tsx",
  "PlaylistDetailScreen.tsx",
  "LocalPlaylistDetailScreen.tsx",
  "BiliCollectionDetailScreen.tsx",
  "LikedSongsScreen.tsx",
  "SearchFallbackDetailScreen.tsx",
  "CustomSourceScreen.tsx",
  "LyricSettingsScreen.tsx",
];
```

For each file assert `ScreenScaffold` exists, `paddingBottom: 100|120` does not exist, and a text node containing Unicode code point `U+2190` does not exist:

```ts
expect(source).toContain("ScreenScaffold");
expect(source).not.toMatch(/paddingBottom:\s*(100|120)/);
expect(source).not.toMatch(/>\s*\u2190\s*</u);
```

- [ ] **Step 2: Run the extended contract and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/screenScaffoldIntegration.test.ts
```

Expected: FAIL for the listed detail files.

- [ ] **Step 3: Implement `DetailHero`**

```ts
export interface DetailHeroProps {
  imageUrl?: string | null;
  title: string;
  subtitle?: string | null;
  metadata?: string[];
  actions?: React.ReactNode;
}
```

Render the cover, title, subtitle, metadata, and actions using the desktop detail hierarchy. Use `CachedImage`, palette tokens, and `flexWrap` for narrow widths.

- [ ] **Step 4: Migrate Root detail screens**

Wrap Artist, Album, Playlist, Local Playlist, Bili Collection, Liked Songs, and Search Fallback in `ScreenScaffold`. Replace their duplicate cover/title blocks with `DetailHero` where the page has artwork. Remove private arrow text and duplicate back toolbars because `AppHeader` supplies history controls.

- [ ] **Step 5: Migrate special settings screens**

Wrap Custom Source and Lyric Settings in `ScreenScaffold`, keep their existing form and safe-area behavior, and replace any arrow text with Lucide `ChevronLeft` only when the screen is presented as a native modal outside the Root shell.

- [ ] **Step 6: Run detail regressions and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/screenScaffoldIntegration.test.ts src/services/__tests__/contentDescriptionIntegration.test.ts src/services/__tests__/playlistDetailActions.test.ts src/services/__tests__/localPlaylistLocateIntegration.test.ts src/services/__tests__/biliCollectionVisibilityModel.test.ts src/services/__tests__/lyricSettingsResetIntegration.test.ts
pnpm mobile:typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

---

### Task 8: Lucide icon and accessibility cleanup

**Files:**
- Create: `apps/mobile/src/services/__tests__/mobileIconAudit.test.ts`
- Modify: `apps/mobile/src/components/ActionMenuSheet.tsx`
- Modify: `apps/mobile/src/components/MusicCard.tsx`
- Modify: `apps/mobile/src/components/SongList.tsx`
- Modify: `apps/mobile/src/screens/HomeScreen.tsx`
- Modify: `apps/mobile/src/screens/immersive/ImmersiveTransport.tsx`
- Modify: all files reported by the audit until no forbidden UI glyph remains.

**Interfaces:**
- Produces: `ActionMenuIconKey` and one Lucide icon map for action-sheet items.
- Consumes: `lucide-react-native`, `Touchable`, and `touch.minTarget`.

- [ ] **Step 1: Write the failing repository icon audit**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const files = [
  "src/components/ActionMenuSheet.tsx",
  "src/components/MusicCard.tsx",
  "src/components/SongList.tsx",
  "src/components/PlayerBar.tsx",
  "src/screens/HomeScreen.tsx",
  "src/screens/immersive/ImmersiveTransport.tsx",
];

describe("mobile icon audit", () => {
  it.each(files)("uses vector icons in %s", (path) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(source).not.toMatch(/[\u{1F500}\u{1F502}\u{1F501}\u{1F507}\u{1F50A}\u{23EE}\u{23ED}\u{23F8}\u{25B6}\u{1F4C1}\u{1F517}\u{2190}]/u);
  });
});
```

- [ ] **Step 2: Run the icon audit and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/mobileIconAudit.test.ts
```

Expected: FAIL in existing glyph-based components.

- [ ] **Step 3: Replace action-sheet string icons with semantic keys**

```ts
export type ActionMenuIconKey = "playNext" | "playlist" | "download" | "share" | "edit" | "delete";

const ACTION_ICONS: Record<ActionMenuIconKey, LucideIcon> = {
  playNext: ListPlus,
  playlist: ListMusic,
  download: Download,
  share: Share2,
  edit: Pencil,
  delete: Trash2,
};
```

Change each action item from a glyph string to an `ActionMenuIconKey`, and render the mapped Lucide component.

- [ ] **Step 4: Replace playback and content glyphs**

Use `Play`, `Pause`, `SkipBack`, `SkipForward`, `Repeat`, `Repeat1`, `Shuffle`, `Volume2`, `VolumeX`, `ChevronLeft`, `FolderPlus`, and `Share2` from `lucide-react-native`. Preserve current actions and accessibility labels. Ensure icon buttons use `touch.minTarget`.

- [ ] **Step 5: Run the icon audit, affected tests, and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/mobileIconAudit.test.ts src/services/__tests__/playerBarIntegration.test.ts src/services/__tests__/immersiveControlsModel.test.ts src/services/__tests__/homeSongActions.test.ts
pnpm mobile:typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

---

### Task 9: Automated verification and USB device acceptance

**Files:**
- Modify only files required by failures proven in this task.
- Update: `docs/mobile-verification-baseline.md` with fresh command output after all checks pass.

**Interfaces:**
- Consumes: the completed mobile application and Android debug toolchain.
- Produces: fresh automated and device evidence.

- [ ] **Step 1: Run targeted parity tests**

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/appShellModel.test.ts src/navigation/navigationHistoryModel.test.ts src/navigation/drawerRouteModel.test.ts src/services/__tests__/appShellIntegration.test.ts src/services/__tests__/appHeaderIntegration.test.ts src/services/__tests__/appSidebarIntegration.test.ts src/services/__tests__/libraryNavigation.test.ts src/services/__tests__/playerBarIntegration.test.ts src/services/__tests__/screenScaffoldIntegration.test.ts src/services/__tests__/mobileIconAudit.test.ts
```

Expected: all targeted tests pass with zero failures.

- [ ] **Step 2: Run the full mobile test suite**

```powershell
pnpm --filter @auralflow/mobile test
```

Expected: all test files and test cases pass; no unhandled errors.

- [ ] **Step 3: Run typecheck and debug build**

```powershell
pnpm mobile:typecheck
pnpm mobile:build:debug
```

Expected: both commands exit `0`; debug APK exists at `apps\mobile\android\app\build\outputs\apk-alt\AuralFlow-1.0-debug.apk`.

- [ ] **Step 4: Restore and verify the USB device**

Ask the user to accept the RSA prompt if the device remains offline, then run:

```powershell
adb kill-server
adb start-server
adb devices -l
```

Expected: device `TSP7MZ55FUHQUKSS` reports state `device`, not `offline`.

- [ ] **Step 5: Install and launch the debug application**

```powershell
adb install -r -t apps\mobile\android\app\build\outputs\apk-alt\AuralFlow-1.0-debug.apk
adb reverse tcp:8081 tcp:8081
adb shell am force-stop cn.chenle.auralflow.mobile
adb shell monkey -p cn.chenle.auralflow.mobile -c android.intent.category.LAUNCHER 1
```

Expected: install succeeds and AuralFlow launches.

- [ ] **Step 6: Perform the device acceptance matrix**

Verify on the connected device:

1. Cold start shows a closed drawer.
2. Menu and left-edge gesture open it.
3. Scrim tap and system back close it.
4. Every drawer item navigates and closes the drawer.
5. Header back, forward, search, and theme work.
6. Portrait and landscape preserve all controls without horizontal overflow.
7. PlayerBar progress, seek, mode, previous, play/pause, next, volume, lyrics, sleep timer, and add-to-playlist work.
8. Home, Search, Daily, FM, Playlists, Downloads, Local, Settings, and every Root detail page render in the shared shell.
9. Notification controls, background playback, and file selection work as Android-native equivalents.

- [ ] **Step 7: Inspect runtime errors**

```powershell
adb logcat -d | Select-String -Pattern 'FATAL EXCEPTION|AndroidRuntime|ReactNativeJS'
```

Expected: no fatal exception or unhandled React Native error attributable to the acceptance run.

- [ ] **Step 8: Review the final change set**

Run:

```powershell
git status --short
rg -n "paddingBottom:\s*(100|120)" apps/mobile/src apps/mobile/App.tsx -g '*.ts' -g '*.tsx'
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/mobileIconAudit.test.ts
```

Expected: no forbidden magic padding or UI glyph matches; unrelated user changes remain untouched and unstaged.
