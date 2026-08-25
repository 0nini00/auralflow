# Immersive Player Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Rebuild the desktop immersive playback layout so metadata is top-centered, the cover sits lower, and centered lyrics scroll with a stable 38% focus anchor.

**Architecture:** Keep playback and window behavior untouched. Move metadata into a dedicated header, adjust the existing grid and lyric styles, and keep all scrolling behavior inside the existing pure controller and hook.

**Tech Stack:** React 18, TypeScript, CSS, Vitest, Tauri 2.

## Global Constraints

- Preserve current player Store API, keyboard mappings, full-screen ownership, queue controls and Tauri commands.
- Do not add new playback features or dependencies.
- Do not commit, reset, clean or overwrite unrelated workspace changes.
- Do not use Emoji in source, tests or documentation.

---

### Task 1: Lock the lyric focus anchor

**Files:**
- Modify: `desktop/src/services/lyrics/autoScrollModel.test.ts`
- Modify: `desktop/src/services/lyrics/autoScrollModel.ts`

**Interfaces:**
- Consumes: `calculateAnchoredLyricScrollTop(metrics)`
- Produces: `LYRIC_SCROLL_ANCHOR_RATIO = 0.38`

- [ ] Add a failing assertion that a 500 px viewport anchors the active line at 38%.
- [ ] Run `pnpm --dir desktop test -- src/services/lyrics/autoScrollModel.test.ts` and confirm the previous 42% assertion fails.
- [ ] Change the shared anchor ratio to 0.38 without altering timing constants.
- [ ] Re-run the targeted test and confirm adjacent, seek, manual-resume and clamp cases still pass.

### Task 2: Move metadata into a dedicated heading

**Files:**
- Modify: `desktop/src/components/ImmersiveLyricsOverlay.tsx`
- Modify: `desktop/src/styles/player.css`

**Interfaces:**
- Consumes: `currentTrack?.name` and `currentTrack?.singer`
- Produces: `.af-immersive-heading`, `.af-immersive-heading-title`, `.af-immersive-heading-artist`

- [ ] Add a top-level header between the background layers and `main`.
- [ ] Render song name and artist in two centered lines using the existing track-change key.
- [ ] Remove the metadata block from the cover section.
- [ ] Add title-bar-safe top spacing, ellipsis constraints and responsive font sizes.

### Task 3: Rebalance cover and lyric presentation

**Files:**
- Modify: `desktop/src/styles/player.css`

**Interfaces:**
- Consumes: existing `.af-immersive-stage`, `.af-immersive-cover-section`, `.af-scrolling-lyrics` classes
- Produces: lower cover placement and centered lyric hierarchy

- [ ] Reduce stage top pressure created by the old metadata block and lower only the cover section.
- [ ] Keep the footer clear at common 1366x768 and 1536x864 window sizes.
- [ ] Set lyric top and bottom spacers to 38% and 62% so CSS matches the scroll model.
- [ ] Reduce inactive line size and weight, strengthen the active line, and tune translation opacity.
- [ ] Preserve centered alignment, hidden scrollbar, manual drag cursor and reduced-motion behavior.

### Task 4: Verify behavior and package

**Files:**
- Review: all files changed in Tasks 1-3

- [ ] Run `pnpm --dir desktop test` and require all tests to pass.
- [ ] Run `pnpm --dir desktop typecheck` and require exit code 0.
- [ ] Run `pnpm --dir desktop build` and require exit code 0.
- [ ] Launch the desktop application and inspect the immersive page at a normal window size and native full screen.
- [ ] Run `pnpm --dir desktop tauri:build` and report the new MSI and executable paths.
