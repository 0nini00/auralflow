# Desktop Daily Recommendations Core Design

## Scope

Bring desktop daily recommendations to feature parity for the approved core scope only: persistent daily snapshots, a 15-day history, cached startup, network-failure fallback, response validation, and history selection. Similar-song and extended-playlist APIs are out of scope.

## Behavior

- Store recommendation snapshots by local calendar date and retain the newest 15 dates.
- Scope stored snapshots by the active NetEase account UID so accounts cannot see each other's recommendations.
- On entry, load persisted snapshots first. Show today's snapshot immediately when available.
- If today is not cached, fetch today's recommendations. If fetching fails, show the newest cached snapshot and preserve the request error.
- A successful fetch must contain at least one valid song. Invalid entries are removed and duplicate `source:id` entries are collapsed before persistence.
- Refresh always targets today and only replaces today's snapshot after a valid non-empty response.
- Users can select any retained snapshot and return to today. Playback, shuffle, per-track playback, add-to-list, and download operate on the selected snapshot.
- New snapshots prune older entries beyond 15.

## Components

- `dailyRecommendCache.ts`: pure normalization/pruning helpers plus `libraryLoad`/`librarySave` persistence under an account-specific namespace.
- `discoveryStore.ts`: owns history metadata, selected date, hydration, refresh, fallback, and account switching.
- `DailyRecommendView.tsx`: initializes the store with the account UID and exposes history selection without changing existing song actions.

## Verification

- Unit tests cover invalid song filtering, deduplication, date ordering, 15-entry pruning, and fallback selection.
- Desktop tests and TypeScript typecheck must pass.
