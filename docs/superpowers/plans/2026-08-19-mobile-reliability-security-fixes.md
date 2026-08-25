# Mobile Reliability and Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复移动端审阅中除自定义音源沙箱绕过和远程更新请求校验之外的全部已确认问题。

**Architecture:** 在现有 Store/Service 分层上增加少量可测试纯模型和一个 Android Keystore 原生模块，不建立第二状态源。启动恢复、快照、缓存和异步请求分别在单一协调点表达不变量，原有 UI 继续消费现有 Store 接口。

**Tech Stack:** React Native 0.86、React 19、TypeScript 5.8、Zustand 5、Vitest 2、Android Java/Kotlin、Android Keystore、Gradle 9。

## Global Constraints

- 不修改自定义音源 WebView 沙箱拦截规则、脚本执行参数或 WebView 权限。
- 不修改自定义音源远程更新请求的出站校验、超时或响应体限制。
- Android 最低版本保持 24，目标版本保持 36。
- 敏感凭据迁移成功前不得删除旧 AsyncStorage 明文。
- 不增加静默回退、空 catch 或伪成功路径。
- 当前共享工作树包含用户未提交改动；实施阶段不创建包含既有改动的 Git commit，每项用定向测试与文件级 diff checkpoint 代替提交。
- 代码、注释、日志和文档不使用 Emoji。

---

### Task 1: Android Keystore 安全存储与迁移

**Files:**
- Create: `apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/SecureStorageModule.java`
- Create: `apps/mobile/src/services/secureStorageService.ts`
- Create: `apps/mobile/src/services/secureStorageMigrationModel.ts`
- Test: `apps/mobile/src/services/secureStorageMigrationModel.test.ts`
- Modify: `apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/LocalMusicPackage.java`
- Modify: `apps/mobile/src/services/wyAccountService.ts`
- Modify: `apps/mobile/src/services/biliService.ts`
- Modify: `apps/mobile/src/services/webdavSyncService.ts`

**Interfaces:**
- Produces: `getSecureItem(key: string): Promise<string | null>`
- Produces: `setSecureItem(key: string, value: string): Promise<void>`
- Produces: `removeSecureItem(key: string): Promise<void>`
- Produces: `migrateLegacySecret(input: LegacySecretMigrationInput): Promise<string | null>`

- [ ] **Step 1: Write failing migration tests**

```ts
it("安全值不存在时迁移旧明文并在成功后删除旧值", async () => {
  const events: string[] = [];
  const value = await migrateLegacySecret({
    readSecure: async () => null,
    readLegacy: async () => "secret",
    writeSecure: async () => { events.push("write"); },
    removeLegacy: async () => { events.push("remove"); },
  });
  expect(value).toBe("secret");
  expect(events).toEqual(["write", "remove"]);
});

it("安全写入失败时保留旧明文", async () => {
  let removed = false;
  await expect(migrateLegacySecret({
    readSecure: async () => null,
    readLegacy: async () => "secret",
    writeSecure: async () => { throw new Error("write failed"); },
    removeLegacy: async () => { removed = true; },
  })).rejects.toThrow("write failed");
  expect(removed).toBe(false);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @auralflow/mobile exec vitest run src/services/secureStorageMigrationModel.test.ts`

Expected: FAIL because `secureStorageMigrationModel.ts` does not exist.

- [ ] **Step 3: Implement migration model**

```ts
export interface LegacySecretMigrationInput {
  readSecure: () => Promise<string | null>;
  readLegacy: () => Promise<string | null>;
  writeSecure: (value: string) => Promise<void>;
  removeLegacy: () => Promise<void>;
}

export async function migrateLegacySecret(input: LegacySecretMigrationInput): Promise<string | null> {
  const secure = await input.readSecure();
  if (secure != null) return secure;
  const legacy = await input.readLegacy();
  if (!legacy) return null;
  await input.writeSecure(legacy);
  await input.removeLegacy();
  return legacy;
}
```

- [ ] **Step 4: Implement native SecureStorageModule**

Use Android Keystore alias `auralflow.mobile.secure-storage.v1`, `AES/GCM/NoPadding`, 12-byte generated IV and 128-bit GCM tag. Store `v1:<iv-base64>:<ciphertext-base64>` in private SharedPreferences named `auralflow_secure_storage`. Expose `getItem`, `setItem`, `removeItem`; reject invalid keys and cryptographic failures with stable `SECURE_STORAGE_*` codes.

- [ ] **Step 5: Register module and add JS adapter**

```ts
interface SecureStorageNativeModule {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```

Throw `Android SecureStorageModule 未注册` when the native module is absent; do not fall back to AsyncStorage.

- [ ] **Step 6: Migrate account and WebDAV services**

- 网易云和 B站 cookie use secure storage and delete legacy keys after confirmed write.
- `WebdavConfig` remains the public shape, but persisted JSON excludes `password`.
- Use secure key `auralflow.mobile.webdav.password`.
- Saving an empty secret removes the secure key.
- `clearWyAccount` and `clearBiliCookie` remove secure and legacy values.

- [ ] **Step 7: Run tests and native compile checkpoint**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/secureStorageMigrationModel.test.ts
pnpm --filter @auralflow/mobile exec tsc --noEmit --pretty false
```

Expected: tests PASS and typecheck exits 0.

- [ ] **Step 8: Diff checkpoint**

Run: `git diff --check -- apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/SecureStorageModule.java apps/mobile/src/services/secureStorageService.ts apps/mobile/src/services/secureStorageMigrationModel.ts apps/mobile/src/services/wyAccountService.ts apps/mobile/src/services/biliService.ts apps/mobile/src/services/webdavSyncService.ts`

---

### Task 2: 启动恢复与协议网络门控

**Files:**
- Create: `apps/mobile/src/services/startupPolicy.ts`
- Test: `apps/mobile/src/services/startupPolicy.test.ts`
- Modify: `apps/mobile/App.tsx`
- Modify: `apps/mobile/src/stores/themeStore.ts`
- Modify: `apps/mobile/src/stores/playbackSettingsStore.ts`

**Interfaces:**
- Produces: `canRunStartupNetworkTasks(pactAccepted: boolean | null): boolean`
- Consumes: existing Store load/check actions.

- [ ] **Step 1: Write failing startup policy tests**

```ts
it.each([false, null])("协议状态 %s 时禁止启动网络任务", (accepted) => {
  expect(canRunStartupNetworkTasks(accepted)).toBe(false);
});

it("已接受协议时允许启动网络任务", () => {
  expect(canRunStartupNetworkTasks(true)).toBe(true);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @auralflow/mobile exec vitest run src/services/startupPolicy.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement startup policy**

```ts
export function canRunStartupNetworkTasks(pactAccepted: boolean | null): boolean {
  return pactAccepted === true;
}
```

- [ ] **Step 4: Refactor App bootstrap**

Add `loadTheme`, `loadPlaybackSettings`, `checkAccountStatus`, and `loadDownloads` actions. Core restore uses `Promise.all`; non-core restore uses `Promise.allSettled` and logs each rejection with source label. Remove `setPactAccepted(true)` from generic startup catch and expose a boot error with retry.

Network effects:

```ts
useEffect(() => {
  if (!canRunStartupNetworkTasks(pactAccepted)) return;
  void checkForUpdates().then(...).catch(...);
}, [pactAccepted]);
```

Apply the same gate to custom source startup updates and WebDAV automatic sync.

- [ ] **Step 5: Make load actions idempotent**

`themeStore.loadTheme` and `playbackSettingsStore.loadFromStorage` return immediately when already loaded, preventing duplicate component-level loads.

- [ ] **Step 6: Run startup tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/startupPolicy.test.ts
pnpm --filter @auralflow/mobile exec tsc --noEmit --pretty false
```

Expected: PASS and exit 0.

- [ ] **Step 7: Diff checkpoint**

Run: `git diff --check -- apps/mobile/App.tsx apps/mobile/src/services/startupPolicy.ts apps/mobile/src/stores/themeStore.ts apps/mobile/src/stores/playbackSettingsStore.ts`

---

### Task 3: 播放快照一致性

**Files:**
- Create: `apps/mobile/src/services/playbackSnapshotModel.ts`
- Test: `apps/mobile/src/services/playbackSnapshotModel.test.ts`
- Modify: `apps/mobile/src/services/playbackSnapshot.ts`

**Interfaces:**
- Produces: `getPlaybackSnapshotSaveTrigger(current, previous): SnapshotSaveTrigger`
- Produces: `isPlaybackSnapshotEmpty(snapshot): boolean`

- [ ] **Step 1: Write failing snapshot model tests**

```ts
it("跨越十秒进度桶时保存", () => {
  expect(getPlaybackSnapshotSaveTrigger(
    { ...BASE, position: 20.1 },
    { ...BASE, position: 19.9 },
  )).toBe("progress");
});

it("暂停时立即保存", () => {
  expect(getPlaybackSnapshotSaveTrigger(
    { ...BASE, isPlaying: false },
    { ...BASE, isPlaying: true },
  )).toBe("pause");
});

it("空队列空当前曲判定为空快照", () => {
  expect(isPlaybackSnapshotEmpty({ currentSong: null, queue: [] })).toBe(true);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @auralflow/mobile exec vitest run src/services/playbackSnapshotModel.test.ts`

Expected: FAIL because model is absent.

- [ ] **Step 3: Implement trigger model**

Return `structural` for current song, queue, index, shuffle history, play mode, rate, volume, mute or playback context changes; `pause` for playing to paused; `progress` when `floor(position / 10)` changes; otherwise `none`.

- [ ] **Step 4: Serialize snapshot writes and delete empty snapshot**

```ts
let snapshotWriteQueue: Promise<void> = Promise.resolve();

function enqueueSnapshotWrite(operation: () => Promise<void>): Promise<void> {
  const next = snapshotWriteQueue.then(operation, operation);
  snapshotWriteQueue = next.catch(() => undefined);
  return next;
}
```

`savePlaybackSnapshot` removes `SNAPSHOT_KEY` for empty state. `clearPlaybackSnapshot` uses the same queue.

- [ ] **Step 5: Persist progress, pause and background state**

Use the pure trigger in the Store subscription. Schedule structural/progress saves with existing debounce; call immediate save on pause. Register one `AppState` listener that saves on `inactive` or `background`, and remove it in teardown. Reset teardown flags on reinitialization.

- [ ] **Step 6: Run tests**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/playbackSnapshotModel.test.ts
pnpm --filter @auralflow/mobile test
```

Expected: all tests PASS.

- [ ] **Step 7: Diff checkpoint**

Run: `git diff --check -- apps/mobile/src/services/playbackSnapshot.ts apps/mobile/src/services/playbackSnapshotModel.ts apps/mobile/src/services/playbackSnapshotModel.test.ts`

---

### Task 4: 搜索历史与建议竞态

**Files:**
- Create: `apps/mobile/src/services/searchHistoryModel.ts`
- Create: `apps/mobile/src/services/latestRequestGate.ts`
- Test: `apps/mobile/src/services/searchHistoryModel.test.ts`
- Test: `apps/mobile/src/services/latestRequestGate.test.ts`
- Modify: `apps/mobile/src/services/searchHistoryService.ts`
- Modify: `apps/mobile/src/screens/SearchScreen.tsx`

**Interfaces:**
- Produces: `updateSearchHistory(history: string[], keyword: string, limit?: number): string[]`
- Produces: `LatestRequestGate.begin(): number`, `invalidate(): void`, `isCurrent(id: number): boolean`

- [ ] **Step 1: Write failing search tests**

```ts
expect(updateSearchHistory(["周杰伦"], "林俊杰")).toEqual(["林俊杰", "周杰伦"]);
expect(updateSearchHistory(["周杰伦", "林俊杰"], "周杰伦")).toEqual(["周杰伦", "林俊杰"]);

const gate = new LatestRequestGate();
const first = gate.begin();
const second = gate.begin();
expect(gate.isCurrent(first)).toBe(false);
expect(gate.isCurrent(second)).toBe(true);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @auralflow/mobile exec vitest run src/services/searchHistoryModel.test.ts src/services/latestRequestGate.test.ts`

Expected: FAIL because models are absent.

- [ ] **Step 3: Implement models and fix history service**

Filter with `item.trim() !== trimmed`, remove empty values, preserve order and enforce limit. Validate loaded JSON is an array of strings; malformed data throws a descriptive error to the caller.

- [ ] **Step 4: Gate search suggestion responses**

Create one `LatestRequestGate` in a ref. Each effect calls `begin`; only current request may call `setSuggestions`. Cleanup and empty/submitted states call `invalidate`.

- [ ] **Step 5: Run tests, typecheck and hooks lint**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/searchHistoryModel.test.ts src/services/latestRequestGate.test.ts
pnpm --filter @auralflow/mobile exec tsc --noEmit --pretty false
pnpm --filter @auralflow/mobile exec eslint src/screens/SearchScreen.tsx
```

Expected: all commands exit 0.

- [ ] **Step 6: Diff checkpoint**

Run: `git diff --check -- apps/mobile/src/services/searchHistoryModel.ts apps/mobile/src/services/latestRequestGate.ts apps/mobile/src/services/searchHistoryService.ts apps/mobile/src/screens/SearchScreen.tsx`

---

### Task 5: 缓存清理与音质维度

**Files:**
- Create: `apps/mobile/src/services/playbackPrefetchModel.ts`
- Test: `apps/mobile/src/services/playbackPrefetchModel.test.ts`
- Modify: `apps/mobile/src/services/playerService.ts`
- Modify: `apps/mobile/src/services/dataCleanupService.ts`
- Modify: `apps/mobile/src/components/CacheSettings.tsx`

**Interfaces:**
- Produces: `buildPlaybackPrefetchKey(song, quality): string`
- Produces: `isPlaybackPrefetchKeyForSong(key, song): boolean`
- Produces: `clearMediaCache(): Promise<number>`

- [ ] **Step 1: Write failing prefetch key tests**

```ts
expect(buildPlaybackPrefetchKey(SONG, "320k")).not.toBe(
  buildPlaybackPrefetchKey(SONG, "flac"),
);
expect(isPlaybackPrefetchKeyForSong("wy:1:flac", SONG)).toBe(true);
expect(isPlaybackPrefetchKeyForSong("wy:2:flac", SONG)).toBe(false);
```

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @auralflow/mobile exec vitest run src/services/playbackPrefetchModel.test.ts`

Expected: FAIL because model is absent.

- [ ] **Step 3: Use quality-aware prefetch keys**

Compute effective quality before every lookup. Pass quality into `getCachedPrefetch`, and write local, persistent and network results under the actual candidate quality. `invalidatePrefetchForSong` iterates map keys and deletes all matching song prefixes.

- [ ] **Step 4: Coordinate full cache clearing**

Add:

```ts
export async function clearMediaCache(): Promise<number> {
  await clearAllCache();
  clearPrefetchCache();
  return getCacheSize();
}
```

`CacheSettings` calls `clearMediaCache`, not `clearAllCache` directly.

- [ ] **Step 5: Run tests**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/playbackPrefetchModel.test.ts
pnpm --filter @auralflow/mobile test
```

Expected: PASS.

- [ ] **Step 6: Diff checkpoint**

Run: `git diff --check -- apps/mobile/src/services/playerService.ts apps/mobile/src/services/playbackPrefetchModel.ts apps/mobile/src/services/dataCleanupService.ts apps/mobile/src/components/CacheSettings.tsx`

---

### Task 6: 歌单详情最新请求获胜

**Files:**
- Modify: `apps/mobile/src/stores/playlistStore.ts`
- Reuse Test: `apps/mobile/src/services/latestRequestGate.test.ts`

**Interfaces:**
- Consumes: `LatestRequestGate` from Task 4.

- [ ] **Step 1: Extend request gate test for invalidation**

```ts
const gate = new LatestRequestGate();
const request = gate.begin();
gate.invalidate();
expect(gate.isCurrent(request)).toBe(false);
```

- [ ] **Step 2: Run test and verify RED if invalidate is missing**

Run: `pnpm --filter @auralflow/mobile exec vitest run src/services/latestRequestGate.test.ts`

Expected: FAIL until `invalidate` exists.

- [ ] **Step 3: Gate playlist detail Store commits**

Create a module-level `playlistDetailRequestGate`. Capture request id before setting loading. After each await and in catch/finally, return without state mutation when the request is stale. Only the current request owns `loading` and `error`.

- [ ] **Step 4: Run tests and typecheck**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/latestRequestGate.test.ts
pnpm --filter @auralflow/mobile exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 5: Diff checkpoint**

Run: `git diff --check -- apps/mobile/src/stores/playlistStore.ts apps/mobile/src/services/latestRequestGate.ts`

---

### Task 7: 自定义音源 runtime 生命周期释放

**Files:**
- Modify: `apps/mobile/src/services/customSourceRuntime.ts`
- Modify: `apps/mobile/src/stores/customSourceStore.ts`
- Modify: `apps/mobile/android/app/src/main/assets/lx_bridge/index.html`
- Test: `apps/mobile/src/services/customSourceRuntimeLifecycleModel.test.ts`
- Create: `apps/mobile/src/services/customSourceRuntimeLifecycleModel.ts`

**Interfaces:**
- Produces: `disposeRuntimeRoute(registry, rid, error): void` pure helper for route cleanup.
- `RuntimeInstance` gains `dispose(): void`.

- [ ] **Step 1: Write failing lifecycle test**

```ts
it("释放 runtime 时删除路由并拒绝挂起请求", () => {
  const registry = createRuntimeLifecycleRegistry();
  const rejected: string[] = [];
  registry.add("rid", "req", (error) => rejected.push(error.message));
  registry.dispose("rid", new Error("disposed"));
  expect(registry.has("rid")).toBe(false);
  expect(rejected).toEqual(["disposed"]);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @auralflow/mobile exec vitest run src/services/customSourceRuntimeLifecycleModel.test.ts`

Expected: FAIL because lifecycle model is absent.

- [ ] **Step 3: Implement runtime disposal**

- Store init timeout handle and clear it.
- Reject pending request promises with `自定义音源运行时已释放`.
- Resolve update alert waiters with `undefined`.
- Delete RN route maps.
- Send `{ type: "dispose", rid }` to WebView.
- WebView handles `dispose` by failing pending HTTP callbacks, clearing map and deleting runtime.

Do not alter `new Function`, static scan regex, WebView props, `fetchRemoteScript` or bridge proxy URL validation.

- [ ] **Step 4: Use full script hash and dispose on invalidation**

Use `CryptoJS.SHA256(normalizeCustomSourceScript(api.script)).toString()` in cache key. `invalidateRuntimeCache`, init failure, source deletion and `replaceAll` dispose old runtime instances before removal.

- [ ] **Step 5: Run tests and exclusion diff audit**

Run:

```powershell
pnpm --filter @auralflow/mobile exec vitest run src/services/customSourceRuntimeLifecycleModel.test.ts
pnpm --filter @auralflow/mobile exec tsc --noEmit --pretty false
git diff -- apps/mobile/src/services/customSourceRuntime.ts apps/mobile/android/app/src/main/assets/lx_bridge/index.html
```

Expected: tests PASS; diff contains lifecycle/hash changes only and no changes to excluded sandbox or remote fetch blocks.

---

### Task 8: Android requestCode、版本、签名和构建可移植性

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/src/services/updateService.ts`
- Modify: `apps/mobile/android/app/build.gradle`
- Modify: `apps/mobile/android/settings.gradle`
- Modify: `apps/mobile/android/gradle.properties`
- Modify: `apps/mobile/build-release-arm64.ps1`
- Modify: `apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/LyricOverlayModule.java`

**Interfaces:**
- `apps/mobile/package.json` adds `androidVersionCode: number`.
- `CURRENT_VERSION` reads package `version`.

- [ ] **Step 1: Add version source fields and consume them in TypeScript**

```json
{
  "version": "0.1.0",
  "androidVersionCode": 1
}
```

```ts
import mobilePackage from "../../package.json";
export const CURRENT_VERSION = mobilePackage.version;
```

- [ ] **Step 2: Read version in Gradle and fail invalid configuration**

Use `groovy.json.JsonSlurper` to parse `apps/mobile/package.json`; require non-empty `version` and positive integer `androidVersionCode`. Assign `versionName` and `versionCode` from parsed values.

- [ ] **Step 3: Remove release debug-signing fallback**

If any requested Gradle task contains `release` and release keystore properties are absent, throw `GradleException`. Debug builds continue using debug signing.

- [ ] **Step 4: Fix Node and ABI configuration**

- `settings.gradle`: `NODE_BIN` or `node` from PATH.
- `gradle.properties`: `armeabi-v7a,arm64-v8a,x86,x86_64`.
- Remove fixed `ndk.abiFilters`.
- Release PowerShell script passes `-PreactNativeArchitectures=arm64-v8a`.

- [ ] **Step 5: Assign unique overlay request code**

Change overlay permission code from `43014` to `43017` and verify no duplicate numeric request codes remain.

- [ ] **Step 6: Run configuration checks**

Run:

```powershell
pnpm --filter @auralflow/mobile exec tsc --noEmit --pretty false
rg -n 'REQUEST_[A-Z_]+\s*=\s*\d+' apps/mobile/android/app/src/main/java
pnpm mobile:build:debug
```

Expected: typecheck exits 0, request codes are unique, debug build succeeds.

- [ ] **Step 7: Verify APK metadata**

Run `aapt2 dump badging` against debug APK.

Expected: `versionName='0.1.0'` and `versionCode='1'`.

---

### Task 9: 无引用代码和原生模块清理

**Files:**
- Delete after final reference scan: `apps/mobile/src/components/MyMusicSections.tsx`
- Delete: `apps/mobile/src/navigation/navigationHistoryModel.ts`
- Delete: `apps/mobile/src/services/artworkColorService.ts`
- Delete: `apps/mobile/src/utils/music.ts`
- Delete: `apps/mobile/src/utils/responsive.ts`
- Delete: `apps/mobile/src/services/downloadDirectoryModel.ts`
- Delete: `apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/ArtworkColorModule.java`
- Modify: `apps/mobile/src/services/downloadService.ts`
- Modify: `apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/LocalMusicPackage.java`
- Modify: `apps/mobile/android/app/build.gradle`

**Interfaces:**
- Removes unused exports and native registration only.

- [ ] **Step 1: Run authoritative reference scan**

Run:

```powershell
rg -n 'MyMusicSections|navigationHistoryModel|artworkColorService|ArtworkColorModule|formatDownloadDirectoryLabel|utils/music|utils/responsive' apps/mobile -g '!**/build/**' -g '!**/.gradle/**' -g '!*.md'
```

Expected: only self-definitions, native registration, dependency and re-export references.

- [ ] **Step 2: Delete dead files and registrations**

Remove the files, `ArtworkColorModule` registration, `androidx.palette` dependency and the unused `formatDownloadDirectoryLabel` re-export.

- [ ] **Step 3: Run reference scan and typecheck**

Run:

```powershell
rg -n 'MyMusicSections|navigationHistoryModel|artworkColorService|ArtworkColorModule|formatDownloadDirectoryLabel|utils/music|utils/responsive' apps/mobile -g '!**/build/**' -g '!**/.gradle/**' -g '!*.md'
pnpm --filter @auralflow/mobile exec tsc --noEmit --pretty false
```

Expected: search returns no references and typecheck exits 0.

---

### Task 10: Full verification and requirement audit

**Files:**
- Modify only files required by failures discovered in verification.

- [ ] **Step 1: Run all mobile tests**

Run: `pnpm test:mobile`

Expected: every test file passes with zero failures.

- [ ] **Step 2: Run typecheck and lint**

Run:

```powershell
pnpm mobile:typecheck
pnpm mobile:lint
```

Expected: both exit 0.

- [ ] **Step 3: Build debug APK**

Run: `pnpm mobile:build:debug`

Expected: `BUILD SUCCESSFUL` and APK generated under `apps/mobile/android/app/build/outputs/apk/debug/`.

- [ ] **Step 4: Verify version and ABI metadata**

Use `aapt2 dump badging` and `apkanalyzer`/`unzip` native library listing.

Expected: package version matches `apps/mobile/package.json`; debug APK contains configured standard ABIs.

- [ ] **Step 5: Verify sensitive values no longer use AsyncStorage**

Run:

```powershell
rg -n 'AsyncStorage\.(setItem|getItem).*?(COOKIE|cookie|password)|password.*AsyncStorage' apps/mobile/src
```

Expected: no cookie or WebDAV password persistence through AsyncStorage.

- [ ] **Step 6: Verify excluded issues remain untouched**

Inspect diff around:

- sandbox regex and `new Function` invocation;
- WebView security props;
- `fetchRemoteScript` request implementation.

Expected: no behavioral changes to excluded item 1 or 2.

- [ ] **Step 7: Final diff audit**

Run:

```powershell
git diff --check -- apps/mobile
git diff --stat -- apps/mobile
git status --short -- apps/mobile
```

Review for silent fallback, duplicate logic, dead code, accidental unrelated edits and user-change loss. Fix every concrete issue before completion.
