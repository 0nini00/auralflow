# Project Consistency and Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正文档与实现偏差，移除音效残留，建立统一测试入口，并在不改变公开功能接口的前提下拆分超大模块与收敛跨端纯逻辑。

**Architecture:** 平台相关编排继续留在 desktop/mobile，纯函数和协议规则进入 `@lx/core` 或平台内聚的 model 模块。结构调整采用移动而非重写，公开路由、Store action、Tauri command 和 Android Bridge 合约保持不变。

**Tech Stack:** pnpm workspace、TypeScript 5.6、Vitest 2.1、React 18、React Native 0.86、Zustand、Tauri v2、Rust/Cargo。

## Global Constraints

- 保留当前工作区全部用户改动，不执行 reset、checkout、clean 或批量覆盖。
- 当前工作直接发生在用户明确要求继续处理的 `main` 脏工作区；由于文件包含混合改动，不自动 commit。
- 不改变现有路由名、Zustand Store API、Tauri command 名称和 Android Bridge 的有效行为。
- 不删除用户磁盘上的历史 `soundEffect.json`。
- 不增加静默 fallback、吞错或第二套真相源。
- 生产代码、注释、日志和 Markdown 不使用 Emoji。

---

### Task 1: 文档、音效死代码与统一测试入口

**Files:**
- Modify: `README.md`
- Modify: `PROJECT_OVERVIEW.md`
- Modify: `apps/mobile/FEATURE_COMPARISON.md`
- Modify: `desktop/src/components/README.md`
- Modify: `desktop/src/stores/README.md`
- Delete: `apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/SoundEffectModule.java`
- Modify: `apps/mobile/android/app/src/main/java/cn/chenle/auralflow/mobile/LocalMusicPackage.java`
- Modify: `desktop/packages/tauri-bridge/src/index.ts`
- Modify: `desktop/src-tauri/src/library.rs`
- Delete: `apps/mobile/_rewrite_immersive.py`
- Modify: `package.json`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/tsconfig.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces root scripts `test:core`, `test:desktop`, `test:mobile`, `test:rust`, `test:all`.
- Produces mobile script `test` with command `vitest run`.
- Removes only the obsolete `soundEffect` persistence type/registration; all other namespace literals and NativeModules remain unchanged.

- [ ] **Step 1: Capture failing consistency checks**

Run:

```powershell
rg -n -S 'SoundTouch|SoundEffect|soundEffect|均衡器|音效面板' README.md PROJECT_OVERVIEW.md apps/mobile desktop packages
node -e "const p=require('./package.json'); if(!p.scripts['test:all']) process.exit(1)"
```

Expected: the reference scan finds obsolete entries and the Node command exits with code 1.

- [ ] **Step 2: Update documentation and remove dead registration/code**

Change the playback description to Web Audio on desktop and TrackPlayer/ExoPlayer on mobile. Describe `@lx/core` as shared models, lyrics, cover/outbound/WebDAV merge and source utilities rather than shared full playback state. Remove obsolete component/store rows. Delete the unused Java module and rewrite helper, unregister the module, and remove `soundEffect` from both desktop namespace allowlists without deleting files on disk.

- [ ] **Step 3: Add test scripts and mobile Vitest dependency**

Set root scripts exactly to:

```json
{
  "test": "pnpm test:all",
  "test:core": "pnpm --filter @lx/core test",
  "test:desktop": "pnpm --filter @auralflow/desktop test",
  "test:mobile": "pnpm --filter @auralflow/mobile test",
  "test:rust": "cargo test --manifest-path desktop/src-tauri/Cargo.toml",
  "test:all": "pnpm test:core && pnpm test:desktop && pnpm test:mobile && pnpm test:rust"
}
```

Add `"test": "vitest run"` and `"vitest": "^2.1.9"` to mobile. Exclude `**/*.test.ts` and `**/*.test.tsx` from mobile production typecheck.

- [ ] **Step 4: Install and verify the entry points**

Run:

```powershell
pnpm install --lockfile-only
pnpm test:core
pnpm test:desktop
pnpm test:rust
```

Expected: dependency resolution succeeds and the three existing suites pass.

### Task 2: 为 mobile 纯逻辑建立回归测试

**Files:**
- Create: `apps/mobile/src/services/songQueueActions.test.ts`
- Create: `apps/mobile/src/services/songSleepTimerModel.test.ts`
- Create: `apps/mobile/src/services/playerRateModel.test.ts`
- Create: `apps/mobile/src/services/playerVolumeModel.test.ts`
- Create: `apps/mobile/src/services/queueNavigationModel.test.ts`

**Interfaces:**
- Tests consume existing pure exports; production modules must not import TrackPlayer, AsyncStorage, React Native or network clients.
- Tests lock queue insertion, sleep countdown, rate clamping, mute/volume transitions and queue navigation behavior.

- [ ] **Step 1: Write behavior-first tests**

Cover at minimum:

```ts
expect(insertSongToPlayNext([a, b], 0, c)).toEqual([a, c, b]);
expect(normalizeSongSleepTimerCount(0)).toBe(1);
expect(clampPlaybackRate(4)).toBe(2);
expect(getNextMuteState({ volume: 0.6, isMuted: false })).toMatchObject({ volume: 0, isMuted: true });
expect(resolveQueueNavigation({ mode: "random", queueLength: 1, currentIndex: 0 })).toBe(0);
```

Use each module's actual exported signature; where the assertion shape differs, preserve the same behavioral invariant rather than adding test-only production APIs.

- [ ] **Step 2: Run tests and expose signature/behavior mismatches**

Run:

```powershell
pnpm test:mobile
```

Expected: any incorrect assumptions fail visibly; adjust tests only to the documented current contract, not to implementation details.

- [ ] **Step 3: Make the smallest production correction required by failing behavior tests**

Only edit the five pure modules if a test reveals a real contract defect. Do not add mocks or alter Store APIs.

- [ ] **Step 4: Verify mobile tests and production checks**

Run:

```powershell
pnpm test:mobile
pnpm mobile:typecheck
pnpm mobile:lint
```

Expected: all commands exit 0.

### Task 3: 收敛双端自定义音源纯逻辑到 core

**Files:**
- Create: `packages/core/src/custom-source.ts`
- Create: `packages/core/src/custom-source.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/mobile/src/services/customSourceRuntime.ts`
- Modify: `desktop/src/services/customSourceRuntime.ts`

**Interfaces:**
- Produces `normalizeCustomSourceScript(script: string): string`.
- Produces `normalizeCustomSourceVersion(value?: string): string`.
- Produces `compareCustomSourceVersions(left?: string, right?: string): number`.
- Produces `normalizeCustomSourceRemoteUrl(url: string): string`.
- Produces `isLikelyCustomSourceRemoteUrl(url: string): boolean`.

- [ ] **Step 1: Write failing core tests**

Test CRLF normalization, optional `v` prefix, unequal version lengths, invalid numeric segments treated as zero, GitHub `blob` to raw conversion, Gitee `blob` to raw conversion, and rejection of ordinary repository home pages by `isLikelyCustomSourceRemoteUrl`.

- [ ] **Step 2: Run the focused test and confirm missing exports**

Run:

```powershell
pnpm --filter @lx/core test -- custom-source.test.ts
```

Expected: FAIL because `custom-source.ts` or its exports do not yet exist.

- [ ] **Step 3: Implement shared functions and replace both local copies**

Move the identical algorithms into core, export them from `index.ts`, import them in both runtimes, and remove local `normalizeScriptForCompare`, `normalizeVersion`, `compareVersions`, `normalizeRemoteScriptUrl`, and `isLikelyRemoteScriptUrl` implementations.

- [ ] **Step 4: Verify core and both platforms**

Run:

```powershell
pnpm --filter @lx/core test -- custom-source.test.ts
pnpm test:core
pnpm mobile:typecheck
pnpm desktop:typecheck
```

Expected: all commands exit 0 and the public runtime exports remain unchanged.

### Task 4: 拆分 mobile playerStore 的剩余纯逻辑

**Files:**
- Create: `apps/mobile/src/services/playerRequestModel.ts`
- Create: `apps/mobile/src/services/playerRequestModel.test.ts`
- Create: `apps/mobile/src/services/playbackErrorRecoveryModel.ts`
- Create: `apps/mobile/src/services/playbackErrorRecoveryModel.test.ts`
- Modify: `apps/mobile/src/stores/playerStore.ts`

**Interfaces:**
- Produces `buildMobilePlayRequestKey(music: MusicInfo): string` with source, id, local URL and quality.
- Produces `getPlaybackErrorRecoveryAction(consecutiveErrors: number): "skip" | "stop"`; the first 3 consecutive errors keep the existing auto-skip behavior and the fourth stops scheduling retries.
- Store action names, state fields and TrackPlayer side effects remain unchanged.

- [ ] **Step 1: Write failing tests for request identity and recovery threshold**

Assert that quality and local URL change request keys, identical tracks produce identical keys, errors 1 through 3 choose `skip`, and error 4 chooses `stop`.

- [ ] **Step 2: Run focused mobile tests**

Run:

```powershell
pnpm --filter @auralflow/mobile test -- playerRequestModel.test.ts playbackErrorRecoveryModel.test.ts
```

Expected: FAIL because the model modules do not exist.

- [ ] **Step 3: Move pure logic and keep orchestration in Store**

Replace the private Store key builder and threshold branch with imports. Preserve `playRequestId`, inflight Promise ownership, timers, TrackPlayer calls and all Zustand fields/actions.

- [ ] **Step 4: Verify Store compatibility**

Run:

```powershell
pnpm test:mobile
pnpm mobile:typecheck
pnpm mobile:lint
```

Expected: all commands exit 0.

### Task 5: 拆分 desktop SettingsView

**Files:**
- Create: `desktop/src/views/settings/SettingRow.tsx`
- Create: `desktop/src/views/settings/AppearanceSettingsSection.tsx`
- Create: `desktop/src/views/settings/PlaybackSettingsSection.tsx`
- Create: `desktop/src/views/settings/SourcesSettingsSection.tsx`
- Create: `desktop/src/views/settings/DesktopLyricSettingsSection.tsx`
- Create: `desktop/src/views/settings/DataSettingsSection.tsx`
- Create: `desktop/src/views/settings/SyncSettingsSection.tsx`
- Create: `desktop/src/views/settings/MiscSettingsSection.tsx`
- Modify: `desktop/src/views/SettingsView.tsx`

**Interfaces:**
- Each component renders the same section root `id` and CSS classes as before.
- `SettingsView` remains the only exported route component and owns `activeSection` plus cross-section async coordination.
- Child sections receive explicit typed values and callbacks; no new Context or Store is introduced.

- [ ] **Step 1: Record structural baseline**

Run:

```powershell
pnpm desktop:typecheck
pnpm --filter @auralflow/desktop test
```

Expected: both pass before movement.

- [ ] **Step 2: Extract shared row and already self-contained sections**

Move `SettingRow`, `DesktopLyricSection`, `SyncSection`, and `MiscSection` first. Rename only the component symbols, not rendered ids, labels, classes or callbacks.

- [ ] **Step 3: Verify the first extraction**

Run:

```powershell
pnpm desktop:typecheck
pnpm --filter @auralflow/desktop test
```

Expected: both pass.

- [ ] **Step 4: Extract inline appearance, playback, sources and data sections**

Create typed prop interfaces from the values already read in `SettingsView`. Move JSX without changing text, event ordering, confirmation prompts, status updates or async handlers.

- [ ] **Step 5: Verify desktop rendering compilation**

Run:

```powershell
pnpm desktop:typecheck
pnpm --filter @auralflow/desktop test
pnpm desktop:build
```

Expected: all commands exit 0 and `SettingsView.tsx` is reduced to navigation/state coordination.

### Task 6: 拆分 Tauri commands.rs

**Files:**
- Modify: `desktop/src-tauri/src/commands.rs`
- Create: `desktop/src-tauri/src/commands/settings.rs`
- Create: `desktop/src-tauri/src/commands/compression.rs`
- Create: `desktop/src-tauri/src/commands/media_cache.rs`
- Create: `desktop/src-tauri/src/commands/bili.rs`
- Create: `desktop/src-tauri/src/commands/downloads.rs`
- Create: `desktop/src-tauri/src/commands/local_audio.rs`
- Create: `desktop/src-tauri/src/commands/library.rs`
- Create: `desktop/src-tauri/src/commands/lyric_window.rs`

**Interfaces:**
- `commands.rs` publicly re-exports every existing `#[tauri::command]` function under the same symbol name.
- `main.rs` invoke handler remains unchanged.
- Existing structs serialized to the frontend retain field names and serde attributes.

- [ ] **Step 1: Capture command and Rust test baseline**

Run:

```powershell
rg -n '^pub (async )?fn ' desktop/src-tauri/src/commands.rs
cargo test --manifest-path desktop/src-tauri/Cargo.toml
```

Expected: command symbol list is captured and tests pass.

- [ ] **Step 2: Move one domain at a time with re-exports**

For each domain, move its command functions, private helpers, constants and private structs together. Add `mod <domain>; pub use <domain>::*;` to `commands.rs`. Do not duplicate helpers between old and new files.

- [ ] **Step 3: Compile after each domain move**

Run after each domain:

```powershell
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

Expected: exit 0 before moving the next domain.

- [ ] **Step 4: Verify command surface and Rust tests**

Run:

```powershell
rg -n '^pub (async )?fn ' desktop/src-tauri/src/commands desktop/src-tauri/src/commands.rs
cargo test --manifest-path desktop/src-tauri/Cargo.toml
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

Expected: all original public command names are present exactly once and both Cargo commands exit 0.

### Task 7: WebDAV shared merge audit

**Files:**
- Modify if required: `packages/core/src/webdav-merge.ts`
- Modify if required: `packages/core/src/webdav-merge.test.ts`
- Modify if required: `apps/mobile/src/services/webdavSyncService.ts`
- Modify if required: `desktop/src/services/webdavSyncService.ts`

**Interfaces:**
- Merge conflict selection remains implemented once in `@lx/core`.
- Platform services retain auth, path construction, serialization and Store persistence.

- [ ] **Step 1: Search for duplicate conflict algorithms**

Run:

```powershell
rg -n 'merge|timestamp|updatedAt|lastModified|conflict' packages/core/src/webdav-merge.ts apps/mobile/src/services/webdavSyncService.ts desktop/src/services/webdavSyncService.ts
```

Expected: identify whether platform files only adapt data or still decide conflicts independently.

- [ ] **Step 2: Add a failing core test for each duplicated decision**

For any duplicated rule, add a case proving newer entries win, equal timestamps remain deterministic, and locally unique/remote unique entries are preserved.

- [ ] **Step 3: Replace platform conflict decisions with core calls**

Only move the duplicated pure decision. Keep network and persistence code platform-specific. If the audit finds no duplicate decision, record that no production edit is required.

- [ ] **Step 4: Verify WebDAV behavior**

Run:

```powershell
pnpm test:core
pnpm test:mobile
pnpm --filter @auralflow/desktop test
pnpm mobile:typecheck
pnpm desktop:typecheck
```

Expected: all commands exit 0.

### Task 8: 全量验证与 diff 审计

**Files:**
- Modify only files needed to fix failures exposed by this task.

**Interfaces:**
- The final workspace satisfies every design invariant without reverting pre-existing user changes.

- [ ] **Step 1: Run all automated suites**

```powershell
pnpm test:all
pnpm mobile:typecheck
pnpm mobile:lint
pnpm desktop:typecheck
pnpm desktop:build
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

Expected: every command exits 0.

- [ ] **Step 2: Build Android debug APK when the local SDK is available**

```powershell
pnpm mobile:build:debug
```

Expected: exit 0; if the SDK/toolchain is unavailable, preserve the exact error as an explicit unverified item.

- [ ] **Step 3: Run consistency and whitespace scans**

```powershell
rg -n -S 'SoundTouch|SoundEffect|soundEffect|均衡器|音效面板' README.md PROJECT_OVERVIEW.md apps/mobile desktop packages
git diff --check
```

Expected: no obsolete production/documentation references and no whitespace errors. A deliberate historical note in the dated design document is allowed.

- [ ] **Step 4: Audit final diff**

Review `git diff --stat`, `git diff --name-status`, and focused diffs for all touched files. Check for duplicate logic, hidden fallback, swallowed errors, dead imports, accidental route/command/action renames and deletion of unrelated user work. Fix every concrete issue found, then rerun the affected verification command.
