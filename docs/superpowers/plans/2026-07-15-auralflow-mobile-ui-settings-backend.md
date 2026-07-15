# AuralFlow Mobile UI, Settings Drawer, and Backend Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the React Native application's visual system with the desktop application, replace the long mobile settings page with a responsive secondary drawer, and eliminate the verified playback, library-navigation, and download-state crashes.

**Architecture:** Keep React Navigation as the active-route truth, Zustand stores as business-state owners, and `playerStore` as the only playback truth. Repair native TrackPlayer compatibility first, remove unstable derived snapshots and mirrored route state, then build the responsive settings navigator and apply desktop-derived visual primitives across high-traffic screens.

**Tech Stack:** React Native 0.86, React 19, TypeScript 5.8, React Navigation 7, Zustand 5, react-native-track-player 4.1.2, lucide-react-native, Vitest 2, Android Gradle Plugin.

## Global Constraints

- The main mobile sidebar remains a default-closed front drawer on both phones and tablets.
- The settings category drawer is default-closed on phones and permanent at widths of `768dp` or greater.
- Responsive behavior may change layout, spacing, wrapping, and column count; it may not hide business capabilities.
- Desktop files are visual references only; this plan does not redesign or modify desktop behavior.
- `desktop/src/styles/theme.css`, `desktop/src/styles/layout.css`, and `desktop/src/styles/settings.css` are the visual truth sources.
- Body text remains `14sp`; Android font scaling remains enabled.
- Every icon-only touch target is at least `44 x 44` and has an accessibility label.
- React Navigation remains the active route and settings-category truth.
- `playerStore` remains the only playback and sleep-timer truth.
- Failures remain explicit in UI state or thrown errors; do not add silent fallbacks or fake success paths.
- Do not add Emoji to source, comments, logs, strings, Markdown, or UI.
- Do not write account Cookies into source, tests, snapshots, logs, or documentation.
- All production behavior changes follow Red-Green-Refactor.
- The existing `apps/mobile` migration is untracked user work. Do not stage or commit implementation files from it. Use exact-path status checkpoints instead.
- Mobile Vitest commands must finish within 60 seconds.

---

## File Structure

### New files

- `apps/mobile/src/services/__tests__/trackPlayerRuntimePatchIntegration.test.ts`: verifies the installed TrackPlayer patch covers ReactHost event emission and null-intent service restarts.
- `apps/mobile/src/services/downloadRecordSelectors.ts`: stable primitive selectors for per-song download status and progress.
- `apps/mobile/src/services/__tests__/downloadRecordSelectors.test.ts`: selector behavior and stability tests.
- `apps/mobile/src/services/libraryRouteModel.ts`: maps Drawer routes and library tabs without mirrored component state.
- `apps/mobile/src/services/libraryRouteModel.test.ts`: exhaustive route/section tests.
- `apps/mobile/src/services/playbackUiAction.ts`: converts thrown playback failures into explicit UI results.
- `apps/mobile/src/services/playbackUiAction.test.ts`: playback UI result tests.
- `apps/mobile/src/services/__tests__/mobileVisualDensityIntegration.test.ts`: source contract for desktop-aligned mobile geometry.
- `apps/mobile/src/navigation/settingsRouteModel.ts`: settings category metadata and route mapping.
- `apps/mobile/src/navigation/settingsRouteModel.test.ts`: settings category coverage tests.
- `apps/mobile/src/navigation/SettingsNavigator.tsx`: nested Settings Stack and responsive Settings Drawer.
- `apps/mobile/src/components/settings/SettingsDrawerContent.tsx`: category drawer UI.
- `apps/mobile/src/components/settings/SettingsPage.tsx`: shared settings category scaffold and phone drawer trigger.
- `apps/mobile/src/screens/settings/AccountSettingsScreen.tsx`
- `apps/mobile/src/screens/settings/AppearanceSettingsScreen.tsx`
- `apps/mobile/src/screens/settings/PlaybackSettingsScreen.tsx`
- `apps/mobile/src/screens/settings/SourcesSettingsScreen.tsx`
- `apps/mobile/src/screens/settings/LyricsSettingsScreen.tsx`
- `apps/mobile/src/screens/settings/SyncSettingsScreen.tsx`
- `apps/mobile/src/screens/settings/DataSettingsScreen.tsx`
- `apps/mobile/src/screens/settings/AboutSettingsScreen.tsx`
- `apps/mobile/src/services/__tests__/settingsNavigationIntegration.test.ts`

### Modified files

- `apps/mobile/apply-track-player-patch.js`
- `apps/mobile/package.json`
- `apps/mobile/src/theme/tokens.ts`
- `apps/mobile/src/components/AppHeader.tsx`
- `apps/mobile/src/components/AppSidebar.tsx`
- `apps/mobile/src/components/ScreenScaffold.tsx`
- `apps/mobile/src/components/SectionHeader.tsx`
- `apps/mobile/src/components/ScreenState.tsx`
- `apps/mobile/src/components/SongList.tsx`
- `apps/mobile/src/components/SearchResultSections.tsx`
- `apps/mobile/src/components/ThemeModeCard.tsx`
- `apps/mobile/src/components/SoundEffectPanel.tsx`
- `apps/mobile/src/components/AppShell.tsx`
- `apps/mobile/src/navigation/types.ts`
- `apps/mobile/src/navigation/MainDrawerNavigator.tsx`
- `apps/mobile/src/navigation/index.ts`
- `apps/mobile/src/screens/SearchScreen.tsx`
- `apps/mobile/src/screens/LibraryScreen.tsx`
- `apps/mobile/src/screens/HomeScreen.tsx`
- `apps/mobile/src/screens/DailyRecommendScreen.tsx`
- `apps/mobile/src/screens/PersonalFmScreen.tsx`
- `apps/mobile/src/screens/DownloadScreen.tsx`
- `apps/mobile/src/screens/ArtistDetailScreen.tsx`
- `apps/mobile/src/screens/AlbumDetailScreen.tsx`
- `apps/mobile/src/screens/PlaylistDetailScreen.tsx`
- `apps/mobile/src/screens/LocalPlaylistDetailScreen.tsx`
- `apps/mobile/src/screens/BiliCollectionDetailScreen.tsx`
- `apps/mobile/src/screens/LikedSongsScreen.tsx`
- `apps/mobile/src/screens/SearchFallbackDetailScreen.tsx`
- `apps/mobile/src/screens/LyricSettingsScreen.tsx`
- `apps/mobile/src/stores/downloadStore.ts`
- `apps/mobile/src/stores/downloadStore.test.ts`
- `apps/mobile/src/stores/playerStore.ts`
- `apps/mobile/src/stores/playerStore.test.ts`
- `apps/mobile/src/services/playerService.ts`
- `apps/mobile/src/services/__tests__/playerServicePersonalFm.test.ts`
- `apps/mobile/src/services/__tests__/appShellIntegration.test.ts`
- `apps/mobile/src/services/__tests__/appSidebarIntegration.test.ts`
- `apps/mobile/src/services/__tests__/screenScaffoldIntegration.test.ts`

### Removed files

- `apps/mobile/src/screens/SettingsScreen.tsx`: replaced after all settings content is migrated.
- `apps/mobile/patches/react-native-track-player+4.1.2.patch.bak`: stale partial patch that does not cover the runtime crash.

---

### Task 1: Repair TrackPlayer ReactHost and service restart compatibility

**Files:**
- Create: `apps/mobile/src/services/__tests__/trackPlayerRuntimePatchIntegration.test.ts`
- Modify: `apps/mobile/apply-track-player-patch.js`
- Remove: `apps/mobile/patches/react-native-track-player+4.1.2.patch.bak`

**Interfaces:**
- Consumes: `react-native-track-player@4.1.2` installed Kotlin sources.
- Produces: a deterministic postinstall patch in which `MusicService.emit()` uses `reactContext` and null-intent restarts return `START_NOT_STICKY`.

- [ ] **Step 1: Write the failing integration test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("TrackPlayer Android runtime patch", () => {
  it("patches ReactHost event emission and null-intent service restarts", () => {
    const patchScript = readFileSync(
      resolve(process.cwd(), "apply-track-player-patch.js"),
      "utf8",
    );

    expect(patchScript).toContain("reactContext");
    expect(patchScript).toContain("intent == null");
    expect(patchScript).toContain("START_NOT_STICKY");
    expect(patchScript).toContain("reactNativeHost.reactInstanceManager.currentReactContext");
    expect(patchScript).toContain("split(from).join(to)");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/trackPlayerRuntimePatchIntegration.test.ts
```

Expected: FAIL because the patch script does not contain the event-emission and null-intent replacements.

- [ ] **Step 3: Make replacements deterministic**

Add a global replacement helper to `apply-track-player-patch.js`:

```js
function replaceAllRequired(content, target, from, to) {
  if (!content.includes(from)) {
    throw new Error(`Pattern not found in ${target}: ${from.trim()}`);
  }
  return content.split(from).join(to);
}
```

Extend the `MusicService.kt` patch entry with:

```js
transform: (content, target) => {
  let next = content;
  next = replaceAllRequired(
    next,
    target,
    "reactNativeHost.reactInstanceManager.currentReactContext",
    "reactContext",
  );
  next = replaceAllRequired(
    next,
    target,
    [
      "    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {",
      "        startTask(getTaskConfig(intent))",
      "        startAndStopEmptyNotificationToAvoidANR()",
      "        return START_STICKY",
      "    }",
    ].join("\\n"),
    [
      "    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {",
      "        if (intent == null) return START_NOT_STICKY",
      "        startTask(getTaskConfig(intent))",
      "        startAndStopEmptyNotificationToAvoidANR()",
      "        return START_NOT_STICKY",
      "    }",
    ].join("\\n"),
  );
  return next;
},
```

Update the patch loop to pass `target` to transforms and to fail instead of warning when required patterns disappear:

```js
if (typeof transform === "function") {
  content = transform(content, target);
}
for (const { from, to } of replacements ?? []) {
  content = replaceAllRequired(content, target, from, to);
}
```

Delete the stale `.bak` patch.

- [ ] **Step 4: Run patch and focused verification**

Run:

```powershell
node apply-track-player-patch.js
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/trackPlayerRuntimePatchIntegration.test.ts
rg -n "reactNativeHost.reactInstanceManager.currentReactContext|intent == null|START_NOT_STICKY" node_modules/react-native-track-player/android/src/main/java/com/doublesymmetry/trackplayer/service/MusicService.kt
```

Expected:

- Patch command exits `0`.
- Test passes.
- Installed Kotlin source contains no `reactNativeHost.reactInstanceManager.currentReactContext`.
- Installed Kotlin source contains the null-intent guard and `START_NOT_STICKY`.

- [ ] **Step 5: Record the checkpoint**

Run:

```powershell
git status --short -- apps/mobile/apply-track-player-patch.js apps/mobile/patches apps/mobile/src/services/__tests__/trackPlayerRuntimePatchIntegration.test.ts
```

Expected: only Task 1 implementation paths are reported.

---

### Task 2: Replace unstable download record snapshots with primitive selectors

**Files:**
- Create: `apps/mobile/src/services/downloadRecordSelectors.ts`
- Create: `apps/mobile/src/services/__tests__/downloadRecordSelectors.test.ts`
- Modify: `apps/mobile/src/stores/downloadStore.ts`
- Modify: `apps/mobile/src/stores/downloadStore.test.ts`
- Modify: `apps/mobile/src/components/SongList.tsx`

**Interfaces:**
- Produces: `selectDownloadStatus(state, song): "idle" | "downloading" | "completed" | "failed"`.
- Produces: `selectDownloadProgress(state, song): number`.
- Consumes: the existing `downloads`, `downloading`, and `failedDownloads` arrays as the only download truth.

- [ ] **Step 1: Write failing selector tests**

```ts
import { describe, expect, it } from "vitest";
import type { MusicInfo } from "@lx/core";
import {
  selectDownloadProgress,
  selectDownloadStatus,
} from "@/services/downloadRecordSelectors";

const song: MusicInfo = {
  id: "1",
  name: "Song",
  singer: "Singer",
  source: "wy",
  quality: "320k",
};

describe("download record selectors", () => {
  it("returns primitive stable values for an active download", () => {
    const state = {
      downloads: [],
      downloading: [{
        song,
        quality: "320k",
        progress: 0.42,
        bytesWritten: 42,
        contentLength: 100,
      }],
      failedDownloads: [],
    };

    expect(selectDownloadStatus(state, song)).toBe("downloading");
    expect(selectDownloadProgress(state, song)).toBe(0.42);
    expect(selectDownloadStatus(state, song)).toBe("downloading");
  });

  it("prioritizes completed over failed records", () => {
    const state = {
      downloads: [{ song, quality: "320k", localPath: "file://song.mp3", downloadDate: 1 }],
      downloading: [],
      failedDownloads: [{ song, quality: "320k", error: "old error", failedAt: 0 }],
    };

    expect(selectDownloadStatus(state, song)).toBe("completed");
    expect(selectDownloadProgress(state, song)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/downloadRecordSelectors.test.ts
```

Expected: FAIL because the selector module does not exist.

- [ ] **Step 3: Implement primitive selectors**

```ts
import type { MusicInfo } from "@lx/core";
import type {
  DownloadingItem,
  FailedDownloadItem,
} from "@/stores/downloadStore";
import type { DownloadedItem } from "@/services/downloadService";

export type DownloadStatus = "idle" | "downloading" | "completed" | "failed";

interface DownloadRecordState {
  downloads: DownloadedItem[];
  downloading: DownloadingItem[];
  failedDownloads: FailedDownloadItem[];
}

function songKey(song: MusicInfo): string {
  return `${song.source}:${song.id}`;
}

function requestedQuality(song: MusicInfo): string | null {
  const value = song.quality;
  return value === "128k" ||
    value === "192k" ||
    value === "320k" ||
    value === "flac" ||
    value === "flac24bit"
    ? value
    : null;
}

function matches(song: MusicInfo, quality: string | undefined, target: MusicInfo): boolean {
  if (songKey(song) !== songKey(target)) return false;
  const requested = requestedQuality(target);
  return requested === null || (quality ?? song.quality ?? "320k") === requested;
}

export function selectDownloadStatus(
  state: DownloadRecordState,
  song: MusicInfo,
): DownloadStatus {
  if (state.downloads.some((item) => matches(item.song, item.quality, song))) return "completed";
  if (state.downloading.some((item) => matches(item.song, item.quality, song))) return "downloading";
  if (state.failedDownloads.some((item) => matches(item.song, item.quality, song))) return "failed";
  return "idle";
}

export function selectDownloadProgress(
  state: DownloadRecordState,
  song: MusicInfo,
): number {
  if (state.downloads.some((item) => matches(item.song, item.quality, song))) return 1;
  return state.downloading.find((item) => matches(item.song, item.quality, song))?.progress ?? 0;
}
```

- [ ] **Step 4: Remove the object-returning store selector**

Remove `DownloadRecordView` and `getRecordBySong` from `downloadStore.ts`. In `SongList.tsx`, replace:

```ts
const downloadRecord = useDownloadStore((state) => state.getRecordBySong(song));
```

with:

```ts
const downloadStatus = useDownloadStore((state) =>
  selectDownloadStatus(state, song),
);
const downloadProgress = useDownloadStore((state) =>
  selectDownloadProgress(state, song),
);
```

Build labels only from primitives:

```ts
const downloadLabel =
  downloadStatus === "completed"
    ? "已下"
    : downloadStatus === "downloading"
      ? `${Math.round(downloadProgress * 100)}%`
      : downloadStatus === "failed"
        ? "重试"
        : "下载";
```

Update store tests to assert `selectDownloadStatus(useDownloadStore.getState(), target)` instead of `getRecordBySong`.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/downloadRecordSelectors.test.ts src/stores/downloadStore.test.ts
pnpm --filter @auralflow/mobile typecheck
```

Expected: all selected tests pass and TypeScript exits `0`.

- [ ] **Step 6: Record the checkpoint**

Run:

```powershell
git status --short -- apps/mobile/src/services/downloadRecordSelectors.ts apps/mobile/src/services/__tests__/downloadRecordSelectors.test.ts apps/mobile/src/stores/downloadStore.ts apps/mobile/src/stores/downloadStore.test.ts apps/mobile/src/components/SongList.tsx
```

Expected: only Task 2 paths are reported.

---

### Task 3: Make React Navigation the only library-section truth

**Files:**
- Create: `apps/mobile/src/services/libraryRouteModel.ts`
- Create: `apps/mobile/src/services/libraryRouteModel.test.ts`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/MainDrawerNavigator.tsx`
- Modify: `apps/mobile/src/screens/LibraryScreen.tsx`
- Modify: `apps/mobile/src/screens/HomeScreen.tsx`
- Modify: `apps/mobile/src/components/AppShell.tsx`
- Modify: `apps/mobile/src/services/__tests__/appShellIntegration.test.ts`

**Interfaces:**
- Produces: `getLibrarySectionForRoute(routeName, params): LibrarySection`.
- Produces: `getLibraryNavigationTarget(section): { name: keyof MainDrawerParamList; params?: object }`.
- Changes: `LibraryScreen` receives `activeSection` and `onSelectSection`; it no longer owns mirrored section state.

- [ ] **Step 1: Write failing route model tests**

```ts
import { describe, expect, it } from "vitest";
import {
  getLibraryNavigationTarget,
  getLibrarySectionForRoute,
} from "@/services/libraryRouteModel";

describe("library route model", () => {
  it.each([
    ["Playlists", undefined, "playlists"],
    ["Local", undefined, "local"],
    ["Library", { section: "history" }, "history"],
    ["Library", { section: "bili" }, "bili"],
  ] as const)("maps %s to %s", (route, params, section) => {
    expect(getLibrarySectionForRoute(route, params)).toBe(section);
  });

  it("maps every library tab to a navigation target", () => {
    expect(getLibraryNavigationTarget("playlists")).toEqual({ name: "Playlists" });
    expect(getLibraryNavigationTarget("local")).toEqual({ name: "Local" });
    expect(getLibraryNavigationTarget("downloads")).toEqual({ name: "Downloads" });
    expect(getLibraryNavigationTarget("history")).toEqual({
      name: "Library",
      params: { section: "history" },
    });
    expect(getLibraryNavigationTarget("bili")).toEqual({
      name: "Library",
      params: { section: "bili" },
    });
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/libraryRouteModel.test.ts
```

Expected: FAIL because `libraryRouteModel.ts` does not exist.

- [ ] **Step 3: Implement the route model**

```ts
import type { MainDrawerParamList } from "@/navigation/types";
import type { LibrarySection } from "@/services/librarySectionModel";

type LibraryRouteName = "Playlists" | "Local" | "Library";

export function getLibrarySectionForRoute(
  routeName: LibraryRouteName,
  params?: { section?: "history" | "bili" },
): Exclude<LibrarySection, "downloads"> {
  if (routeName === "Playlists") return "playlists";
  if (routeName === "Local") return "local";
  return params?.section ?? "history";
}

export function getLibraryNavigationTarget(
  section: LibrarySection,
): {
  name: keyof MainDrawerParamList;
  params?: MainDrawerParamList[keyof MainDrawerParamList];
} {
  if (section === "playlists") return { name: "Playlists" };
  if (section === "local") return { name: "Local" };
  if (section === "downloads") return { name: "Downloads" };
  return { name: "Library", params: { section } };
}
```

- [ ] **Step 4: Remove route consumption and mirrored state**

Change `MainDrawerParamList`:

```ts
Playlists: undefined;
Local: undefined;
Downloads: undefined;
Library: { section: "history" | "bili" };
```

Change `LibraryScreen` props:

```ts
interface LibraryScreenProps {
  onNavigateToPlayer: () => void;
  activeSection: Exclude<LibrarySection, "downloads">;
  onSelectSection: (section: LibrarySection) => void;
}
```

Delete:

```ts
const [activeSection, setActiveSection] = useState<LibrarySection>("playlists");
useEffect(() => {
  if (!initialSection) return;
  setActiveSection(initialSection);
  onInitialSectionConsumed?.();
}, [initialSection, onInitialSectionConsumed]);
```

Replace tab presses with:

```tsx
onPress={() => onSelectSection(section)}
```

In each Drawer route wrapper, derive `activeSection` from its route and use:

```ts
const handleSelectSection = (section: LibrarySection) => {
  const target = getLibraryNavigationTarget(section);
  navigation.navigate(target.name as never, target.params as never);
};
```

Update Home history navigation to:

```ts
navigation.navigate("Library", { section: "history" });
```

- [ ] **Step 5: Add a source regression assertion**

Extend `appShellIntegration.test.ts`:

```ts
it("does not clear library route params through an inline callback", () => {
  const drawer = read("src/navigation/MainDrawerNavigator.tsx");
  const library = read("src/screens/LibraryScreen.tsx");

  expect(drawer).not.toContain("onInitialSectionConsumed");
  expect(library).not.toContain("setActiveSection");
  expect(library).not.toContain("onInitialSectionConsumed");
});
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/libraryRouteModel.test.ts src/navigation/drawerRouteModel.test.ts src/services/__tests__/appShellIntegration.test.ts
pnpm --filter @auralflow/mobile typecheck
```

Expected: all selected tests pass and TypeScript exits `0`.

- [ ] **Step 7: Record the checkpoint**

Run:

```powershell
git status --short -- apps/mobile/src/services/libraryRouteModel.ts apps/mobile/src/services/libraryRouteModel.test.ts apps/mobile/src/navigation/types.ts apps/mobile/src/navigation/MainDrawerNavigator.tsx apps/mobile/src/screens/LibraryScreen.tsx apps/mobile/src/screens/HomeScreen.tsx apps/mobile/src/components/AppShell.tsx apps/mobile/src/services/__tests__/appShellIntegration.test.ts
```

Expected: only Task 3 paths are reported.

---

### Task 4: Propagate playback failures to UI callers

**Files:**
- Create: `apps/mobile/src/services/playbackUiAction.ts`
- Create: `apps/mobile/src/services/playbackUiAction.test.ts`
- Modify: `apps/mobile/src/stores/playerStore.ts`
- Modify: `apps/mobile/src/stores/playerStore.test.ts`
- Modify: `apps/mobile/src/services/playerService.ts`
- Modify: `apps/mobile/src/services/__tests__/playerServicePersonalFm.test.ts`
- Modify: `apps/mobile/src/screens/SearchScreen.tsx`
- Modify: `apps/mobile/src/screens/DailyRecommendScreen.tsx`
- Modify: `apps/mobile/src/screens/PersonalFmScreen.tsx`
- Modify: `apps/mobile/src/screens/LibraryScreen.tsx`
- Modify: detail screens listed in the File Structure

**Interfaces:**
- Produces: `runPlaybackUiAction(action): Promise<{ ok: true } | { ok: false; message: string }>`.
- Changes: `playerStore.play()` and `playSongCore()` set error state and rethrow the original failure.

- [ ] **Step 1: Write failing UI result tests**

```ts
import { describe, expect, it } from "vitest";
import { runPlaybackUiAction } from "@/services/playbackUiAction";

describe("playback UI action", () => {
  it("returns success only after the action resolves", async () => {
    await expect(
      runPlaybackUiAction(() => Promise.resolve()),
    ).resolves.toEqual({ ok: true });
  });

  it("preserves the thrown playback message", async () => {
    await expect(
      runPlaybackUiAction(() => Promise.reject(new Error("TrackPlayer failed"))),
    ).resolves.toEqual({ ok: false, message: "TrackPlayer failed" });
  });
});
```

- [ ] **Step 2: Add a failing player store assertion**

Add to `playerStore.test.ts`:

```ts
it("rejects when TrackPlayer cannot start playback", async () => {
  trackPlayer.play.mockRejectedValueOnce(new Error("native playback failed"));

  await expect(
    usePlayerStore.getState().play(song, "https://audio.example.com/song.mp3"),
  ).rejects.toThrow("native playback failed");
  expect(usePlayerStore.getState().error).toBe("native playback failed");
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/playbackUiAction.test.ts src/stores/playerStore.test.ts
```

Expected: helper module is missing and `playerStore.play()` resolves instead of rejecting.

- [ ] **Step 4: Implement explicit propagation**

Create:

```ts
export type PlaybackUiResult =
  | { ok: true }
  | { ok: false; message: string };

export async function runPlaybackUiAction(
  action: () => Promise<void>,
): Promise<PlaybackUiResult> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
```

In `playerStore.play()`:

```ts
} catch (error) {
  const message = error instanceof Error ? error.message : "播放失败";
  console.error("Play error:", error);
  set({ loading: false, error: message });
  throw error;
}
```

In `playSongCore()`:

```ts
} catch (error) {
  const message = error instanceof Error ? error.message : "播放失败";
  console.error("Play song error:", error);
  setError(message);
  throw error;
} finally {
  setLoading(false);
}
```

For screen handlers, navigate only after success and expose failure in the screen's existing error state:

```ts
const result = await runPlaybackUiAction(() => playQueue(songs, index));
if (!result.ok) {
  setError(result.message);
  return;
}
onNavigateToPlayer();
```

Where a screen does not own an error state, add `playbackError` local state and render:

```tsx
{playbackError ? <ErrorState message={playbackError} /> : null}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/playbackUiAction.test.ts src/stores/playerStore.test.ts src/services/__tests__/playerServicePersonalFm.test.ts
pnpm --filter @auralflow/mobile typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

- [ ] **Step 6: Record the checkpoint**

Run:

```powershell
git status --short -- apps/mobile/src/services/playbackUiAction.ts apps/mobile/src/services/playbackUiAction.test.ts apps/mobile/src/stores/playerStore.ts apps/mobile/src/stores/playerStore.test.ts apps/mobile/src/services/playerService.ts apps/mobile/src/services/__tests__/playerServicePersonalFm.test.ts apps/mobile/src/screens
```

Expected: Task 4 paths and previously modified screen paths are visible; nothing is staged.

---

### Task 5: Align shared mobile visual primitives with desktop density

**Files:**
- Create: `apps/mobile/src/services/__tests__/mobileVisualDensityIntegration.test.ts`
- Modify: `apps/mobile/src/theme/tokens.ts`
- Modify: `apps/mobile/src/components/AppHeader.tsx`
- Modify: `apps/mobile/src/components/AppSidebar.tsx`
- Modify: `apps/mobile/src/components/ScreenScaffold.tsx`
- Modify: `apps/mobile/src/components/SectionHeader.tsx`
- Modify: `apps/mobile/src/components/ScreenState.tsx`
- Modify: existing scaffold/sidebar integration tests

**Interfaces:**
- Produces: shared `layout.pagePadding`, `layout.songRowMinHeight`, `layout.artworkSize`, and `breakpoints.tablet`.
- Keeps: `touch.minTarget === 44`.

- [ ] **Step 1: Write the failing visual contract**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("mobile visual density", () => {
  it("uses desktop-aligned geometry without an outer phone card", () => {
    const tokens = read("src/theme/tokens.ts");
    const scaffold = read("src/components/ScreenScaffold.tsx");
    const header = read("src/components/AppHeader.tsx");

    expect(tokens).toContain("pagePadding: 16");
    expect(tokens).toContain("songRowMinHeight: 60");
    expect(tokens).toContain("artworkSize: 48");
    expect(tokens).toContain("tablet: 768");
    expect(scaffold).not.toContain("borderRadius: radius.xl");
    expect(scaffold).toContain("paddingHorizontal: layout.pagePadding");
    expect(header).toContain("minHeight: 56");
  });

  it("keeps accessible icon targets while using compact visual icons", () => {
    const tokens = read("src/theme/tokens.ts");
    const sidebar = read("src/components/AppSidebar.tsx");

    expect(tokens).toContain("minTarget: 44");
    expect(sidebar).toContain("minHeight: touch.minTarget");
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/mobileVisualDensityIntegration.test.ts
```

Expected: FAIL because the final token names and compact geometry are absent.

- [ ] **Step 3: Update shared tokens**

Use:

```ts
export const layout = {
  pagePadding: 16,
  tabletPagePadding: 20,
  songRowMinHeight: 60,
  songRowPadding: 8,
  artworkSize: 48,
  headerHeight: 56,
  compactControlHeight: 36,
} as const;

export const breakpoints = {
  tablet: 768,
} as const;
```

Keep the existing spacing, radius, typography, and `touch.minTarget: 44` scales.

- [ ] **Step 4: Apply geometry to shared components**

`ScreenScaffold` phone surface:

```ts
surface: {
  flex: 1,
  minWidth: 0,
  backgroundColor: "transparent",
},
content: {
  flexGrow: 1,
  minWidth: 0,
  paddingHorizontal: layout.pagePadding,
  paddingTop: spacing.xs,
  paddingBottom: spacing.l,
},
```

`AppHeader`:

```ts
bar: {
  minHeight: layout.headerHeight,
  borderWidth: StyleSheet.hairlineWidth,
  borderRadius: radius.xl,
  paddingHorizontal: spacing.xs,
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xxs,
},
```

`AppSidebar` navigation items:

```ts
itemInner: {
  minHeight: touch.minTarget,
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  paddingHorizontal: spacing.xs,
},
```

Use 18–20 visual icon sizes and remove excess vertical padding. Reduce `ScreenState` card padding and radius to `radius.md`.

- [ ] **Step 5: Run focused integration tests**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/mobileVisualDensityIntegration.test.ts src/services/__tests__/screenScaffoldIntegration.test.ts src/services/__tests__/appSidebarIntegration.test.ts src/services/__tests__/appHeaderIntegration.test.ts
pnpm --filter @auralflow/mobile typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

- [ ] **Step 6: Record the checkpoint**

Run:

```powershell
git status --short -- apps/mobile/src/theme/tokens.ts apps/mobile/src/components/AppHeader.tsx apps/mobile/src/components/AppSidebar.tsx apps/mobile/src/components/ScreenScaffold.tsx apps/mobile/src/components/SectionHeader.tsx apps/mobile/src/components/ScreenState.tsx apps/mobile/src/services/__tests__
```

Expected: Task 5 paths are visible and nothing is staged.

---

### Task 6: Compact search, song rows, and high-traffic screens

**Files:**
- Modify: `apps/mobile/src/components/SongList.tsx`
- Modify: `apps/mobile/src/components/SearchResultSections.tsx`
- Modify: `apps/mobile/src/screens/SearchScreen.tsx`
- Modify: `apps/mobile/src/screens/HomeScreen.tsx`
- Modify: `apps/mobile/src/screens/DailyRecommendScreen.tsx`
- Modify: `apps/mobile/src/screens/PersonalFmScreen.tsx`
- Modify: `apps/mobile/src/screens/DownloadScreen.tsx`
- Modify: `apps/mobile/src/services/__tests__/screenScaffoldIntegration.test.ts`

**Interfaces:**
- Consumes: Task 5 tokens and shared components.
- Produces: a five-tab search control that fits the viewport without clipping and 60dp song rows with 48dp artwork.

- [ ] **Step 1: Add failing source assertions**

Extend `screenScaffoldIntegration.test.ts`:

```ts
it("keeps all five search categories inside the phone viewport", () => {
  const source = readSource("screens", "SearchScreen.tsx");

  expect(source).toContain("styles.tabList");
  expect(source).toContain("flex: 1");
  expect(source).toContain("minWidth: 0");
  expect(source).not.toContain("<ScrollView\\n            horizontal");
});

it("uses shared compact song geometry", () => {
  const source = readSource("components", "SongList.tsx");

  expect(source).toContain("minHeight: layout.songRowMinHeight");
  expect(source).toContain("width: layout.artworkSize");
  expect(source).toContain("padding: layout.songRowPadding");
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/screenScaffoldIntegration.test.ts
```

Expected: FAIL because search tabs still use a horizontally clipped control and song rows do not use the final minimum height.

- [ ] **Step 3: Implement the compact search control**

Replace the horizontal tabs ScrollView with:

```tsx
<View style={styles.tabList}>
  {SEARCH_TABS.map((tab) => (
    <Pressable
      key={tab.key}
      style={[
        styles.tabButton,
        { backgroundColor: screenTheme.cardBackground },
        activeTab === tab.key && {
          backgroundColor: screenTheme.strongBackground,
          borderColor: screenTheme.primaryBackground,
        },
      ]}
      onPress={() => setActiveTab(tab.key)}
      accessibilityRole="tab"
      accessibilityState={{ selected: activeTab === tab.key }}
    >
      <Text style={styles.tabText}>{tab.label}</Text>
    </Pressable>
  ))}
</View>
```

Use:

```ts
tabList: {
  width: "100%",
  flexDirection: "row",
  gap: spacing.xxs,
},
tabButton: {
  flex: 1,
  minWidth: 0,
  minHeight: layout.compactControlHeight,
  borderRadius: radius.sm,
  borderWidth: StyleSheet.hairlineWidth,
  paddingHorizontal: spacing.xxs,
  alignItems: "center",
  justifyContent: "center",
},
```

Reduce search suggestion, history, and summary-card padding to the shared spacing scale.

- [ ] **Step 4: Apply shared row density**

Add to `SongList` item style:

```ts
minHeight: layout.songRowMinHeight,
padding: layout.songRowPadding,
```

Keep action touch targets at 44, but use `18` or `20` icon sizes. Apply the same compact row/card conventions to search artist, album, and playlist results.

Update high-traffic screens to remove redundant `marginBottom: 20/24`, use shared `spacing`, and avoid nested cards around existing cards.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/screenScaffoldIntegration.test.ts src/services/__tests__/mobileVisualDensityIntegration.test.ts src/services/__tests__/quickActionCoverIntegration.test.ts
pnpm --filter @auralflow/mobile typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

- [ ] **Step 6: Record the checkpoint**

Run:

```powershell
git status --short -- apps/mobile/src/components/SongList.tsx apps/mobile/src/components/SearchResultSections.tsx apps/mobile/src/screens/SearchScreen.tsx apps/mobile/src/screens/HomeScreen.tsx apps/mobile/src/screens/DailyRecommendScreen.tsx apps/mobile/src/screens/PersonalFmScreen.tsx apps/mobile/src/screens/DownloadScreen.tsx
```

Expected: Task 6 paths are visible and nothing is staged.

---

### Task 7: Add the responsive settings route model and nested navigators

**Files:**
- Create: `apps/mobile/src/navigation/settingsRouteModel.ts`
- Create: `apps/mobile/src/navigation/settingsRouteModel.test.ts`
- Create: `apps/mobile/src/navigation/SettingsNavigator.tsx`
- Create: `apps/mobile/src/components/settings/SettingsDrawerContent.tsx`
- Create: `apps/mobile/src/components/settings/SettingsPage.tsx`
- Create: `apps/mobile/src/services/__tests__/settingsNavigationIntegration.test.ts`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/MainDrawerNavigator.tsx`
- Modify: `apps/mobile/src/navigation/index.ts`
- Modify: `apps/mobile/src/components/AppShell.tsx`

**Interfaces:**
- Produces: `SettingsDrawerParamList` with eight category routes.
- Produces: `SettingsStackParamList` with `Categories`, `Login`, `WebDav`, `CustomSources`, and `LyricDetail`.
- Produces: `SETTINGS_CATEGORIES` as the only category metadata source.

- [ ] **Step 1: Write failing category model tests**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS_CATEGORY,
  SETTINGS_CATEGORIES,
  getSettingsCategory,
} from "@/navigation/settingsRouteModel";

describe("settings route model", () => {
  it("defines the eight approved categories in order", () => {
    expect(SETTINGS_CATEGORIES.map((item) => item.name)).toEqual([
      "Account",
      "Appearance",
      "Playback",
      "Sources",
      "Lyrics",
      "Sync",
      "Data",
      "About",
    ]);
    expect(DEFAULT_SETTINGS_CATEGORY).toBe("Account");
  });

  it("returns the matching category metadata", () => {
    expect(getSettingsCategory("Playback").label).toBe("播放与音效");
  });
});
```

- [ ] **Step 2: Write failing navigation integration assertions**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("settings navigation integration", () => {
  it("uses a phone front drawer and tablet permanent drawer", () => {
    const navigator = read("src/navigation/SettingsNavigator.tsx");

    expect(navigator).toContain("width >= breakpoints.tablet");
    expect(navigator).toContain('drawerType: isTablet ? "permanent" : "front"');
    expect(navigator).toContain("swipeEnabled: false");
  });

  it("does not keep boolean page navigation in the old settings screen", () => {
    const drawer = read("src/navigation/MainDrawerNavigator.tsx");

    expect(drawer).toContain("SettingsNavigator");
    expect(drawer).not.toContain("<SettingsScreen");
  });
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/navigation/settingsRouteModel.test.ts src/services/__tests__/settingsNavigationIntegration.test.ts
```

Expected: FAIL because the model and navigator do not exist.

- [ ] **Step 4: Implement the category model**

```ts
export type SettingsCategoryName =
  | "Account"
  | "Appearance"
  | "Playback"
  | "Sources"
  | "Lyrics"
  | "Sync"
  | "Data"
  | "About";

export interface SettingsCategory {
  name: SettingsCategoryName;
  label: string;
  description: string;
  icon:
    | "account"
    | "appearance"
    | "playback"
    | "sources"
    | "lyrics"
    | "sync"
    | "data"
    | "about";
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { name: "Account", label: "账号", description: "网易云与 B站账号", icon: "account" },
  { name: "Appearance", label: "外观", description: "主题、强调色与背景", icon: "appearance" },
  { name: "Playback", label: "播放与音效", description: "音质、打断策略与均衡器", icon: "playback" },
  { name: "Sources", label: "音源", description: "自定义音源管理", icon: "sources" },
  { name: "Lyrics", label: "歌词", description: "沉浸歌词与悬浮歌词", icon: "lyrics" },
  { name: "Sync", label: "同步", description: "WebDAV 数据同步", icon: "sync" },
  { name: "Data", label: "数据", description: "缓存与历史清理", icon: "data" },
  { name: "About", label: "关于", description: "版本与软件更新", icon: "about" },
] as const;

export const DEFAULT_SETTINGS_CATEGORY: SettingsCategoryName = "Account";

export function getSettingsCategory(name: SettingsCategoryName): SettingsCategory {
  const category = SETTINGS_CATEGORIES.find((item) => item.name === name);
  if (!category) throw new Error(`Unknown settings category: ${name}`);
  return category;
}
```

- [ ] **Step 5: Add typed nested navigation**

Add to `navigation/types.ts`:

```ts
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
```

Implement `SettingsNavigator.tsx` with a native stack containing a nested drawer. The Drawer options must include:

```ts
const isTablet = width >= breakpoints.tablet;

screenOptions={{
  headerShown: false,
  drawerType: isTablet ? "permanent" : "front",
  swipeEnabled: false,
  drawerStyle: { width: isTablet ? 188 : Math.min(300, width * 0.82) },
  overlayColor: "rgba(0, 0, 0, 0.38)",
  lazy: true,
}}
```

Mount `SettingsNavigator` from the outer `MainDrawerNavigator` Settings route.

- [ ] **Step 6: Close the deepest open drawer on Android back**

Add a recursive helper in `AppShell.tsx`:

```ts
function findOpenDrawerKey(state?: NavigationState): string | null {
  if (!state) return null;
  const activeRoute = state.routes[state.index ?? 0];
  const nested = activeRoute?.state as NavigationState | undefined;
  const nestedKey = findOpenDrawerKey(nested);
  if (nestedKey) return nestedKey;
  if (state.type !== "drawer") return null;
  return getDrawerStatusFromState(
    state as DrawerNavigationState<ParamListBase>,
  ) === "open"
    ? state.key
    : null;
}
```

Use the target key before history replay:

```ts
const openDrawerKey = findOpenDrawerKey(navigationRef.getRootState());
if (openDrawerKey) {
  navigationRef.dispatch({
    ...DrawerActions.closeDrawer(),
    target: openDrawerKey,
  });
  return true;
}
```

- [ ] **Step 7: Run tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/navigation/settingsRouteModel.test.ts src/services/__tests__/settingsNavigationIntegration.test.ts src/services/__tests__/appShellIntegration.test.ts
pnpm --filter @auralflow/mobile typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

- [ ] **Step 8: Record the checkpoint**

Run:

```powershell
git status --short -- apps/mobile/src/navigation/settingsRouteModel.ts apps/mobile/src/navigation/settingsRouteModel.test.ts apps/mobile/src/navigation/SettingsNavigator.tsx apps/mobile/src/components/settings apps/mobile/src/navigation/types.ts apps/mobile/src/navigation/MainDrawerNavigator.tsx apps/mobile/src/navigation/index.ts apps/mobile/src/components/AppShell.tsx
```

Expected: Task 7 paths are visible and nothing is staged.

---

### Task 8: Migrate settings content into category screens and route-backed details

**Files:**
- Create: eight `apps/mobile/src/screens/settings/*SettingsScreen.tsx` files listed above.
- Modify: `apps/mobile/src/navigation/SettingsNavigator.tsx`
- Modify: `apps/mobile/src/components/ThemeModeCard.tsx`
- Modify: `apps/mobile/src/components/SoundEffectPanel.tsx`
- Modify: `apps/mobile/src/screens/LyricSettingsScreen.tsx`
- Remove: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/src/services/__tests__/settingsNavigationIntegration.test.ts`
- Modify: `apps/mobile/src/services/__tests__/settingsVersionIntegration.test.ts`

**Interfaces:**
- Each category screen renders `SettingsPage`.
- Detail navigation uses `SettingsStackParamList`; no category screen owns a page-navigation boolean.
- Produces: `LyricSettingsContent({ onBack })` for both the Settings route and the immersive-player modal wrapper.

- [ ] **Step 1: Extend the failing integration contract**

Add:

```ts
it("renders one route-backed category at a time", () => {
  const navigator = read("src/navigation/SettingsNavigator.tsx");
  const account = read("src/screens/settings/AccountSettingsScreen.tsx");
  const playback = read("src/screens/settings/PlaybackSettingsScreen.tsx");

  expect(navigator).toContain('name="Account"');
  expect(navigator).toContain('name="About"');
  expect(account).toContain("<SettingsPage");
  expect(playback).toContain("<SoundEffectPanel");
});

it("uses stack routes for settings details", () => {
  const navigator = read("src/navigation/SettingsNavigator.tsx");

  expect(navigator).toContain('name="Login"');
  expect(navigator).toContain('name="WebDav"');
  expect(navigator).toContain('name="CustomSources"');
  expect(navigator).toContain('name="LyricDetail"');
  expect(navigator).not.toContain("showLoginModal");
  expect(navigator).not.toContain("showLyricSettings");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/settingsNavigationIntegration.test.ts
```

Expected: FAIL because category screens and detail routes are not wired.

- [ ] **Step 3: Implement the shared settings page**

`SettingsPage.tsx` public interface:

```tsx
export interface SettingsPageProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function SettingsPage({
  title,
  description,
  children,
}: SettingsPageProps) {
  const { width } = useWindowDimensions();
  const navigation =
    useNavigation<DrawerNavigationProp<SettingsDrawerParamList>>();
  const showCategoryButton = width < breakpoints.tablet;

  return (
    <ScreenScaffold>
      <ScreenScrollView>
        <SectionHeader
          title={title}
          description={description}
          action={showCategoryButton ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="打开设置分类"
              style={styles.categoryButton}
              onPress={() => navigation.openDrawer()}
            >
              <ListFilter size={18} />
              <Text>分类</Text>
            </Pressable>
          ) : undefined}
        />
        <View style={styles.content}>{children}</View>
      </ScreenScrollView>
    </ScreenScaffold>
  );
}
```

- [ ] **Step 4: Move content into the eight categories**

Use these exact responsibilities:

```tsx
// AccountSettingsScreen
<SettingsPage title="账号" description="管理网易云与 B站登录状态">
  <AccountInfo onLoginPress={() => navigation.navigate("Login")} />
  <BiliAccountCard />
</SettingsPage>

// AppearanceSettingsScreen
<SettingsPage title="外观" description="主题、强调色与应用背景">
  <ThemeModeCard />
  <AppBackgroundCard />
</SettingsPage>

// PlaybackSettingsScreen
<SettingsPage title="播放与音效" description="播放音质、音频打断和音效">
  <PlaybackQualitySettings />
  <ExternalPlaybackSettings />
  <SoundEffectPanel />
</SettingsPage>

// SourcesSettingsScreen
<SettingsPage title="音源" description="导入、测试和更新自定义音源">
  <SettingsLinkRow
    title="自定义音源"
    subtitle={sourceSummary}
    onPress={() => navigation.navigate("CustomSources")}
  />
</SettingsPage>

// LyricsSettingsScreen
<SettingsPage title="歌词" description="沉浸歌词、译文和悬浮歌词">
  <SettingsLinkRow
    title="歌词样式"
    subtitle="字号、行距、颜色、译文与字体"
    onPress={() => navigation.navigate("LyricDetail")}
  />
  <LyricOverlaySettings />
</SettingsPage>

// SyncSettingsScreen
<SettingsPage title="同步" description="通过 WebDAV 同步歌单和音源">
  <SettingsLinkRow
    title="WebDAV 同步"
    subtitle={webdavSummary}
    onPress={() => navigation.navigate("WebDav")}
  />
</SettingsPage>

// DataSettingsScreen
<SettingsPage title="数据" description="查看并清理缓存与播放历史">
  <CacheSettings />
</SettingsPage>

// AboutSettingsScreen
<SettingsPage title="关于" description="应用版本与软件更新">
  <VersionRow version={CURRENT_VERSION} />
  <UpdateCheckRow />
</SettingsPage>
```

Small category-only helper components may remain in their category file. Shared row components belong under `components/settings`.

- [ ] **Step 5: Make lyric settings content reusable**

Extract the current modal body:

```tsx
export interface LyricSettingsContentProps {
  onBack: () => void;
}

export function LyricSettingsContent({
  onBack,
}: LyricSettingsContentProps) {
  return (
    <ScreenScaffold>
      <ScreenScrollView>
        <LyricSettingsHeader onBack={onBack} />
        <LyricSettingsControls />
      </ScreenScrollView>
    </ScreenScaffold>
  );
}
```

Keep the immersive wrapper:

```tsx
export function LyricSettingsScreen({
  visible,
  onBack,
}: LyricSettingsScreenProps) {
  return (
    <Modal visible={visible} onRequestClose={onBack}>
      <LyricSettingsContent onBack={onBack} />
    </Modal>
  );
}
```

Render `LyricSettingsContent` directly from the Settings Stack `LyricDetail` route.

- [ ] **Step 6: Wire stack detail screens and remove the old page**

In `SettingsNavigator.tsx`, mount:

```tsx
<Stack.Screen name="Login">
  {({ navigation }) => <LoginScreen onSuccess={() => navigation.goBack()} />}
</Stack.Screen>
<Stack.Screen name="WebDav">
  {({ navigation }) => <WebDavSyncScreen onBack={() => navigation.goBack()} />}
</Stack.Screen>
<Stack.Screen name="CustomSources">
  {({ navigation }) => <CustomSourceScreen onBack={() => navigation.goBack()} />}
</Stack.Screen>
<Stack.Screen name="LyricDetail">
  {({ navigation }) => <LyricSettingsContent onBack={() => navigation.goBack()} />}
</Stack.Screen>
```

After every existing setting is mapped, delete `SettingsScreen.tsx`.

- [ ] **Step 7: Apply desktop-aligned settings density**

Replace hardcoded large values in `ThemeModeCard` and `SoundEffectPanel` with shared tokens. Required rules:

```ts
card: {
  borderRadius: radius.md,
  borderWidth: StyleSheet.hairlineWidth,
  padding: spacing.s,
  gap: spacing.s,
},
row: {
  minHeight: 56,
  paddingHorizontal: spacing.s,
  paddingVertical: spacing.xs,
},
```

No setting row may use a decorative dashed border. Category selection uses a muted surface and a 3dp green left indicator.

- [ ] **Step 8: Run settings tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/navigation/settingsRouteModel.test.ts src/services/__tests__/settingsNavigationIntegration.test.ts src/services/__tests__/settingsVersionIntegration.test.ts src/services/__tests__/lyricSettingsResetIntegration.test.ts
pnpm --filter @auralflow/mobile typecheck
```

Expected: selected tests pass and TypeScript exits `0`.

- [ ] **Step 9: Record the checkpoint**

Run:

```powershell
git status --short -- apps/mobile/src/navigation/SettingsNavigator.tsx apps/mobile/src/components/settings apps/mobile/src/screens/settings apps/mobile/src/screens/SettingsScreen.tsx apps/mobile/src/screens/LyricSettingsScreen.tsx apps/mobile/src/components/ThemeModeCard.tsx apps/mobile/src/components/SoundEffectPanel.tsx
```

Expected: settings migration paths are visible and nothing is staged.

---

### Task 9: Full automated verification and diff review

**Files:**
- Review all files modified by Tasks 1–8.
- Modify only files required to fix failures found by verification.

**Interfaces:**
- Produces: a test-clean and buildable mobile package before device installation.

- [ ] **Step 1: Run targeted regression tests**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/__tests__/trackPlayerRuntimePatchIntegration.test.ts src/services/__tests__/downloadRecordSelectors.test.ts src/services/libraryRouteModel.test.ts src/services/playbackUiAction.test.ts src/navigation/settingsRouteModel.test.ts src/services/__tests__/settingsNavigationIntegration.test.ts src/services/__tests__/mobileVisualDensityIntegration.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Run the full mobile test suite**

Run:

```powershell
pnpm --filter @auralflow/mobile test
```

Expected: exit `0`, no failed tests.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile typecheck
```

Expected: exit `0`.

- [ ] **Step 4: Run the Android Debug build**

Run:

```powershell
pnpm --filter @auralflow/mobile android:assembleDebug
```

Expected: Gradle exits `0` and produces:

```text
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
apps/mobile/android/app/build/outputs/apk-alt/AuralFlow-1.0-debug.apk
```

- [ ] **Step 5: Review the implementation diff**

Run:

```powershell
git diff --check
git diff -- apps/mobile
git status --short
```

Review for:

- object-returning Zustand selectors used directly by React components
- inline navigation callbacks used as effect dependencies
- swallowed playback failures
- duplicate settings route state
- hardcoded oversized spacing or radius values
- touch targets smaller than 44
- credentials or account data
- unrelated user migration files

Fix confirmed issues, then repeat Steps 1–5.

---

### Task 10: Install the current APK and complete device acceptance

**Files:**
- Evidence only under `.git/sdd/`; no credentials or Cookie input screenshots.

**Interfaces:**
- Consumes: the Debug APK from Task 9.
- Produces: device screenshots, UI trees, APK hashes, and Logcat evidence.

- [ ] **Step 1: Confirm device and APK identity**

Run:

```powershell
adb devices -l
Get-FileHash 'apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk' -Algorithm SHA256
```

Expected: device `TSP7MZ55FUHQUKSS` is `device`, and the APK hash is recorded.

- [ ] **Step 2: Install the current build**

Run:

```powershell
adb install -r 'apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk'
adb shell dumpsys package cn.chenle.auralflow.mobile | Select-String -Pattern 'versionName|versionCode|lastUpdateTime'
```

Expected: installation succeeds and `lastUpdateTime` changes to the current test time.

- [ ] **Step 3: Verify shell and visual behavior**

Verify on device:

1. Cold launch keeps the main drawer closed.
2. Main drawer opens, closes with system back, and has no bottom business navigation.
3. Header height, search field, drawer rows, and page spacing match the compact design.
4. Search shows all five category labels without clipping.
5. Song rows use compact artwork and spacing while action targets remain easy to tap.

Capture screenshots and UI trees without credential fields.

- [ ] **Step 4: Verify settings navigation**

Verify:

1. Settings opens the Account category.
2. Phone settings drawer is closed initially.
3. “分类” opens the secondary drawer.
4. All eight categories render one content page at a time.
5. WebDAV, custom source, lyric detail, and login routes return correctly.
6. System back closes the secondary drawer before global history.

- [ ] **Step 5: Verify authenticated backend paths**

Using the existing app-private login state:

1. 网易云账号信息 loads.
2. 每日推荐 loads songs.
3. 私人 FM loads preview songs.
4. B站账号 information loads.
5. B站合集 loads and opens a collection.
6. Update check returns a visible result.

WebDAV and custom source remote calls are only marked verified when valid user configuration is present.

- [ ] **Step 6: Verify playback and downloads**

Clear Logcat, then:

1. Search for `jay`.
2. Play a result and confirm the app remains foreground.
3. Pause, resume, next, background, and foreground the app.
4. Confirm the media notification remains functional.
5. Download a 320K result.
6. Open Downloads and confirm the completed or explicit failed record is visible.
7. Open Playlists, Local Music, History, and B站合集 without red screens.

- [ ] **Step 7: Audit Logcat**

Run:

```powershell
adb logcat -d -v threadtime ReactNativeJS:V AndroidRuntime:E '*:S'
```

Expected: no application-process occurrences of:

```text
FATAL EXCEPTION
Maximum update depth exceeded
addViewAt: failed to insert view
You should not use ReactNativeHost directly
ForegroundServiceStartNotAllowedException
```

- [ ] **Step 8: Compare installed APK hash**

Run:

```powershell
adb shell pm path cn.chenle.auralflow.mobile
```

Pull the installed APK to a temporary path, compute SHA256, and confirm it matches the locally built APK. Remove the temporary copy after comparison.

---

## Self-Review

### Spec coverage

- Desktop-derived mobile visual system: Tasks 5 and 6.
- Main drawer default-hidden behavior: Tasks 5 and 10.
- Responsive settings category drawer: Tasks 7 and 8.
- Removal of boolean settings navigation: Task 8.
- TrackPlayer ReactHost and foreground restart crashes: Task 1.
- Library route update loop: Task 3.
- Download selector update loop: Task 2.
- Explicit playback errors: Task 4.
- Authenticated 网易云 and B站 verification: Task 10.
- Tests, typecheck, build, APK identity, and Logcat audit: Tasks 9 and 10.
- Credential exclusion: Global Constraints, Task 9 diff review, and Task 10 evidence rules.

### Placeholder scan

- The plan contains no unresolved placeholder steps.
- Every production change names exact files, interfaces, tests, commands, and expected results.
- External WebDAV and custom-source success remains explicitly conditional on user configuration rather than being reported as verified.

### Type consistency

- `SettingsCategoryName` exactly matches `SettingsDrawerParamList`.
- Library route targets match `MainDrawerParamList`.
- Download selectors consume the existing arrays and return primitives.
- Playback UI actions consume thrown `Promise<void>` operations and return one discriminated result type.
- `LyricSettingsContent` is the shared content API used by both route and modal wrappers.

## Execution Handoff

The user requested immediate execution in the current task. Use `superpowers:executing-plans` for inline execution with checkpoints. Do not dispatch subagents because the user did not request delegation and the active collaboration rules prohibit unsolicited subagents.
