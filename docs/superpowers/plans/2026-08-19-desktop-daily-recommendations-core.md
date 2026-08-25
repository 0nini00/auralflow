# Desktop Daily Recommendations Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account-scoped persistent daily recommendation snapshots, 15-day history, validation, cached startup, and failure fallback to the desktop app.

**Architecture:** A focused cache service owns normalization, pruning, and Tauri library persistence. The discovery store coordinates account hydration, network refresh, fallback, and selected history date; the existing view renders the selected snapshot and a compact date selector.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, Tauri bridge library persistence.

## Global Constraints

- Keep snapshots scoped by NetEase UID.
- Retain at most 15 dates, newest first.
- Never overwrite a valid snapshot with an empty or invalid API response.
- Do not add similar-song or extended-playlist APIs.
- Preserve all existing playback, add-to-list, and download behavior.

---

### Task 1: Daily recommendation cache service

**Files:**
- Create: `desktop/src/services/dailyRecommendCache.ts`
- Create: `desktop/src/services/dailyRecommendCache.test.ts`

**Interfaces:**
- Produces: `DailyRecommendSnapshot`, `normalizeDailySongs(songs)`, `normalizeDailyRecommendHistory(value)`, `saveDailyRecommendSnapshot(uid, snapshot)`, `loadDailyRecommendHistory(uid)`.

- [ ] **Step 1: Write failing tests**

Test that normalization removes entries without `source`, `id`, or `name`; deduplicates by `source:id`; sorts snapshots newest-first; and retains 15 snapshots.

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @auralflow/desktop test -- dailyRecommendCache.test.ts`
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the service**

Use `libraryLoad` and `librarySave` with namespace `daily-recommend:${encodeURIComponent(uid)}`. Define snapshots as `{ date: string; songs: MusicInfo[]; cachedAt: number }`. Normalize unknown persisted input defensively and prune after every write.

- [ ] **Step 4: Run the focused test**

Run: `pnpm --filter @auralflow/desktop test -- dailyRecommendCache.test.ts`
Expected: PASS.

### Task 2: Discovery store history lifecycle

**Files:**
- Modify: `desktop/src/stores/discoveryStore.ts`
- Create: `desktop/src/stores/discoveryStore.test.ts`

**Interfaces:**
- Consumes: cache interfaces from Task 1 and existing `getDailyRecommend()`.
- Produces state fields `dailyHistory`, `dailySelectedDate`, `dailyAccountUid`, `dailyHydrated`; actions `initializeDaily(uid)`, `selectDailyDate(date)`, `selectToday()`; preserves `loadDaily(force?)` and `refreshDaily()`.

- [ ] **Step 1: Write failing store tests**

Cover cached-today startup without a network fetch, uncached startup fetch and persistence, network failure fallback to newest history, refresh not overwriting valid cache with an empty response, date selection, and account switching.

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @auralflow/desktop test -- discoveryStore.test.ts`
Expected: FAIL because the history lifecycle fields and actions are absent.

- [ ] **Step 3: Implement the store lifecycle**

Hydrate account history before deciding whether to fetch. Keep `daily` and `dailyDate` as the selected snapshot for compatibility. Refresh today, validate through `normalizeDailySongs`, reject empty normalized responses, persist successful snapshots, and restore the newest cached snapshot on failure. Ignore stale async results when the active UID changes.

- [ ] **Step 4: Run the focused test**

Run: `pnpm --filter @auralflow/desktop test -- discoveryStore.test.ts`
Expected: PASS.

### Task 3: Daily recommendations history controls

**Files:**
- Modify: `desktop/src/views/DailyRecommendView.tsx`
- Modify: `desktop/src/styles/playlists.css`

**Interfaces:**
- Consumes: `initializeDaily`, `dailyHistory`, `dailySelectedDate`, `selectDailyDate`, and `selectToday` from Task 2.

- [ ] **Step 1: Update account initialization**

Replace direct `loadDaily()` on account presence with `initializeDaily(account.uid)`. Ensure logout clears the selected account data through `initializeDaily('')` or an explicit reset path.

- [ ] **Step 2: Add history selection controls**

Render retained dates as a compact select control near the refresh action. Label today as `今日`; show a `返回今日` command while viewing history. Disable refresh while viewing history or make it explicitly return to and refresh today.

- [ ] **Step 3: Preserve selected snapshot actions**

Confirm play-all, shuffle, row playback, add-to-list, and download continue to use `daily`, which now represents the selected snapshot.

- [ ] **Step 4: Add focused styling**

Add only the layout rules required for the history select and return-to-today action, following existing button and form styles.

- [ ] **Step 5: Run verification**

Run: `pnpm --filter @auralflow/desktop test`
Expected: all tests PASS.

Run: `pnpm --filter @auralflow/desktop typecheck`
Expected: PASS with no TypeScript errors.

Run: `cargo check` from `desktop/src-tauri`.
Expected: PASS.
