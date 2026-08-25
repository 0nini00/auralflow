# Mobile Button Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one complete button/control system for ordinary mobile actions and migrate inconsistent controls without changing business behavior.

**Architecture:** Extend the existing theme geometry tokens with semantic control tokens. Build `Button`, `IconButton`, `Chip`, `ListItemButton`, and `ModalActions` under `src/components/ui/`; keep `ActionButton`, `ChoiceChip`, and `Touchable` as compatibility surfaces only where necessary, then migrate ordinary consumers by semantic role. Leave gesture surfaces and custom animated controls unchanged.

**Tech Stack:** React Native 0.86, TypeScript 5.8, Zustand theme store, `lucide-react-native`, Vitest.

## Global Constraints

- Do not change playback, navigation, network, store, or business behavior.
- Use theme palette values from `themeStore` and shared tokens; do not add page-specific semantic button colors.
- Preserve existing callbacks, disabled/loading conditions, accessibility labels, and navigation targets.
- Do not replace modal backdrops, cover gestures, lyric gestures, playlist row containers, or custom animated controls.
- Keep touch targets usable on small screens and text within controls.
- Run mobile typecheck, tests, lint, and Android debug build after migration.

---

### Task 1: Add semantic control tokens

**Files:**
- Modify: `apps/mobile/src/theme/tokens.ts`
- Test: `apps/mobile/src/theme/controlTokens.test.ts`

**Interfaces:**
- Produces exported `control` token object and related types consumed by UI components.

- [ ] **Step 1: Write the failing token test**

Create assertions that `control.button` exposes `small`, `medium`, and `large` heights, `control.iconButton` exposes `compact`, `standard`, and `large` sizes, and every size is at least 36 while the standard touch target is at least 44.

- [ ] **Step 2: Run the focused test**

Run `pnpm --dir apps/mobile exec vitest run src/theme/controlTokens.test.ts`.
Expected: FAIL because `control` is not exported.

- [ ] **Step 3: Implement tokens**

Add geometry and typography tokens based on existing `spacing`, `radius`, `typography`, and `touch`. Keep semantic colors in the existing runtime palette rather than duplicating color literals.

- [ ] **Step 4: Run the focused test**

Run the same command and expect PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/theme/tokens.ts apps/mobile/src/theme/controlTokens.test.ts
git commit -m "feat(mobile): add shared control tokens"
```

### Task 2: Build Button and IconButton

**Files:**
- Create: `apps/mobile/src/components/ui/Button.tsx`
- Create: `apps/mobile/src/components/ui/IconButton.tsx`
- Create: `apps/mobile/src/components/ui/index.ts`
- Test: `apps/mobile/src/components/ui/controlModel.test.ts`

**Interfaces:**
- `Button`: `variant` (`primary | secondary | outline | danger | ghost`), `size` (`small | medium | large`), `loading`, `disabled`, optional `leading` and `trailing` React nodes, standard press props, and accessibility props.
- `IconButton`: `size` (`compact | standard | large`), `tone` (`default | muted | inverse | danger | translucent`), `loading`, `disabled`, `children`, and accessibility props.

- [ ] **Step 1: Add behavior tests**

Test pure style/model helpers for each variant and size, disabled/loading state, default accessibility role, and icon touch slop. Avoid requiring a native renderer; test exported model helpers or render-independent functions.

- [ ] **Step 2: Run focused tests and verify failure**

Run `pnpm --dir apps/mobile exec vitest run src/components/ui/controlModel.test.ts`.
Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement components**

Use the theme store palette at render time. Implement fixed size presets, shared radius/border rules, pressed opacity, disabled/loading state, `ActivityIndicator`, minimum touch targets, and forwarded accessibility state. Allow `style` only as a layout extension.

- [ ] **Step 4: Run focused tests**

Run the focused test and expect PASS.

- [ ] **Step 5: Run TypeScript**

Run `pnpm --dir apps/mobile typecheck` and fix all new type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/ui apps/mobile/src/theme
git commit -m "feat(mobile): add shared button controls"
```

### Task 3: Build Chip, ListItemButton, and ModalActions

**Files:**
- Create: `apps/mobile/src/components/ui/Chip.tsx`
- Create: `apps/mobile/src/components/ui/ListItemButton.tsx`
- Create: `apps/mobile/src/components/ui/ModalActions.tsx`
- Modify: `apps/mobile/src/components/ui/index.ts`
- Test: `apps/mobile/src/components/ui/compoundControlModel.test.ts`

**Interfaces:**
- `Chip`: `label`, `selected`, `onPress`, `disabled`, optional leading icon, and accessibility state.
- `ListItemButton`: title, optional subtitle, leading/trailing nodes, disabled, destructive, and press props.
- `ModalActions`: secondary and primary action descriptors with label, callback, disabled/loading, and optional destructive primary action.

- [ ] **Step 1: Add model tests**

Cover selected/unselected Chip state, destructive list row state, modal action ordering, loading/disabled propagation, and narrow-layout direction selection.

- [ ] **Step 2: Run focused tests and verify failure**

Run `pnpm --dir apps/mobile exec vitest run src/components/ui/compoundControlModel.test.ts`.
Expected: FAIL before implementation.

- [ ] **Step 3: Implement components**

Use shared control tokens and palette semantics. Ensure labels do not overflow, list rows preserve full-width layout, and modal actions can wrap or stack on narrow screens.

- [ ] **Step 4: Run focused tests and TypeScript**

Run the focused test and `pnpm --dir apps/mobile typecheck`; both must pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/ui
 git commit -m "feat(mobile): add shared choice and modal controls"
```

### Task 4: Consolidate existing ActionButton and ChoiceChip

**Files:**
- Modify: `apps/mobile/src/components/ActionButton.tsx`
- Modify: `apps/mobile/src/components/ChoiceChip.tsx`
- Modify: consumers discovered with `rg -n "ActionButton|ChoiceChip" apps/mobile/src`

**Interfaces:**
- Existing public props remain source-compatible for current consumers.
- Internally delegate to the new `Button` and `Chip` semantics where possible.

- [ ] **Step 1: Inventory consumers**

Run `rg -n "ActionButton|ChoiceChip" apps/mobile/src` and classify each use as text action, choice chip, or special layout.

- [ ] **Step 2: Add compatibility tests**

Verify `ActionButton` preserves `label`, `count`, `grow`, `shrink`, `small`, `loading`, and variant behavior, while `ChoiceChip` preserves `onImage` behavior and selected accessibility state.

- [ ] **Step 3: Delegate implementation**

Replace duplicated semantic styling with the new primitives while retaining only compatibility-specific layout props.

- [ ] **Step 4: Run mobile tests and typecheck**

Run `pnpm --dir apps/mobile test` and `pnpm --dir apps/mobile typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/ActionButton.tsx apps/mobile/src/components/ChoiceChip.tsx apps/mobile/src
 git commit -m "refactor(mobile): consolidate existing action controls"
```

### Task 5: Migrate settings, account, cache, download, and modal actions

**Files:**
- Modify: ordinary action consumers under `apps/mobile/src/components/` and `apps/mobile/src/screens/` identified by `Pressable` inventory.
- Do not modify: backdrop, gesture, cover, lyric, and list-container Pressables.

**Interfaces:**
- Each migrated screen keeps its current callback, loading state, disabled state, label, accessibility label, and layout contract.

- [ ] **Step 1: Produce migration inventory**

Run `rg -l "Pressable" apps/mobile/src/components apps/mobile/src/screens` and inspect each occurrence. Record the semantic component replacement and intentional exclusions in `docs/superpowers/specs/2026-08-20-mobile-button-design-system.md`.

- [ ] **Step 2: Migrate the highest-confidence screens**

Replace ordinary actions in account/login, settings, cache, download quality, batch download, playlist management, and modal footers with `Button`, `IconButton`, `Chip`, `ListItemButton`, or `ModalActions`.

- [ ] **Step 3: Run focused checks**

Run `pnpm --dir apps/mobile typecheck`, `pnpm --dir apps/mobile lint`, and `pnpm --dir apps/mobile test`.

- [ ] **Step 4: Commit the migration batch**

```bash
git add apps/mobile/src/components apps/mobile/src/screens docs/superpowers/specs/2026-08-20-mobile-button-design-system.md
git commit -m "refactor(mobile): unify account settings and modal controls"
```

### Task 6: Migrate search, detail, library, and playlist actions

**Files:**
- Modify: search, album/artist/playlist, library, history, favorite, local music, and download action consumers under `apps/mobile/src/screens/` and `apps/mobile/src/components/`.

**Interfaces:**
- Preserve row navigation and playback callbacks; only ordinary action surfaces move to shared controls.

- [ ] **Step 1: Migrate text and icon actions**

Use `Button` for labeled actions, `IconButton` for icon-only actions, and `ListItemButton` for settings/menu rows. Keep song rows and navigation containers as-is unless only their trailing action is being replaced.

- [ ] **Step 2: Migrate filters and selection controls**

Use `Chip` for quality, sort, filter, and mode selections, preserving selected state and accessibility state.

- [ ] **Step 3: Run checks**

Run `pnpm --dir apps/mobile typecheck`, `pnpm --dir apps/mobile lint`, and `pnpm --dir apps/mobile test`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components apps/mobile/src/screens
git commit -m "refactor(mobile): unify library and playlist controls"
```

### Task 7: Migrate player utility and immersive icon actions

**Files:**
- Modify: player bar, player screens, immersive screens, lyric settings, and related action components under `apps/mobile/src/components/` and `apps/mobile/src/screens/`.

**Interfaces:**
- Preserve playback actions, gesture handling, animation values, and custom layout dimensions.

- [ ] **Step 1: Classify special controls**

Keep animated transport controls and gesture surfaces unchanged where shared dimensions would break animation. Replace only ordinary utility actions such as close, more, settings, favorite, queue, and refresh.

- [ ] **Step 2: Migrate eligible controls**

Use `IconButton` with explicit tone/size and accessibility labels. Use `Button` or `Chip` for ordinary labeled controls in lyric/player settings.

- [ ] **Step 3: Run checks**

Run `pnpm --dir apps/mobile typecheck`, `pnpm --dir apps/mobile lint`, and `pnpm --dir apps/mobile test`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components apps/mobile/src/screens
 git commit -m "refactor(mobile): unify player utility controls"
```

### Task 8: Final audit and Android verification

**Files:**
- Modify: any remaining ordinary control consumers found during audit.
- Update: `docs/superpowers/specs/2026-08-20-mobile-button-design-system.md` with intentional exclusions.

- [ ] **Step 1: Audit remaining Pressable usage**

Run `rg -n "Pressable" apps/mobile/src` and inspect every remaining usage. Every ordinary action must use the shared controls; every remaining direct `Pressable` must be an intentional gesture/container exclusion documented by file and reason.

- [ ] **Step 2: Run all JavaScript checks**

Run:

```bash
pnpm --dir apps/mobile typecheck
pnpm --dir apps/mobile lint
pnpm --dir apps/mobile test
```

- [ ] **Step 3: Build Android debug APK**

Run `pnpm --dir apps/mobile android:assembleDebug`.
Expected: Gradle completes successfully and produces the debug APK under `apps/mobile/android/app/build/outputs/apk/debug/`.

- [ ] **Step 4: Review theme states**

Review representative controls in light and dark themes on login, settings, playlist management, download modal, search/detail, and immersive player screens. Confirm contrast, text fit, disabled/loading states, and touch targets.

- [ ] **Step 5: Commit final audit**

```bash
git add apps/mobile docs/superpowers/specs/2026-08-20-mobile-button-design-system.md
git commit -m "chore(mobile): verify unified control system"
```
