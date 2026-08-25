# Mobile Button Design System

## Goal

Unify the visual and interaction behavior of ordinary action controls across `apps/mobile` without changing business logic, navigation behavior, playback behavior, or special gesture interactions.

## Scope

### In scope

- Text actions: primary, secondary, outline, danger, and ghost buttons.
- Icon actions: navigation, close, more, favorite, delete, refresh, and playback utility actions.
- Choice controls: quality, filter, sort, playback mode, and tag selection chips.
- List action rows used as settings or menu actions.
- Modal footer actions such as cancel and confirm.
- Shared states: pressed, disabled, loading, selected, and theme changes.
- Migration of ordinary action controls currently implemented with local `Pressable` styles.

### Out of scope

- Modal backdrop dismissal controls.
- Cover tap and long-press gestures.
- Lyric drag or gesture surfaces.
- Playlist row containers whose primary purpose is navigation or gesture handling.
- Custom animated controls that require their own layout or animation contract.
- Player business logic, navigation logic, network behavior, and store contracts.

## Architecture

Create a small control layer under `apps/mobile/src/components/ui/`:

- `Button.tsx`: text and optional icon actions.
- `IconButton.tsx`: fixed-size icon-only actions.
- `Chip.tsx`: selectable compact options.
- `ListItemButton.tsx`: full-width settings/menu actions.
- `ModalActions.tsx`: consistent modal action rows.

Use the existing `Touchable` component as the common press-feedback primitive where its behavior is compatible. Evaluate the existing `ActionButton` and `ChoiceChip` components during migration; either make them compatible wrappers or migrate their consumers to the new components, but do not leave two competing public APIs for the same semantic control.

Keep visual values in theme-level tokens. Extend `apps/mobile/src/theme/tokens.ts` or add narrowly scoped token modules for:

- semantic control colors;
- control heights and icon sizes;
- horizontal and vertical spacing;
- border widths and radii;
- typography variants;
- pressed, disabled, loading, and selected opacity/color behavior.

The components must consume theme values rather than hard-code page-specific colors or dimensions.

## Component Contracts

### Button

Props should support:

- `variant`: `primary | secondary | outline | danger | ghost`;
- `size`: `small | medium | large`;
- `loading` and `disabled`;
- optional leading/trailing icon content;
- standard React Native press props;
- accessibility role and label forwarding;
- limited style extension for layout only, without allowing consumers to redefine semantic colors or dimensions by default.

Default behavior is `variant="primary"` and `size="medium"`.

### IconButton

Props should support:

- `size`: `compact | standard | large`;
- `tone`: `default | muted | inverse | danger | translucent`;
- disabled/loading behavior;
- fixed minimum touch target;
- default `hitSlop` and accessibility role.

Icon-only controls must receive an explicit accessibility label from callers when the icon does not have an unambiguous label.

### Chip

Props should support:

- selected/unselected state;
- disabled state;
- compact and regular sizing where needed;
- optional leading icon;
- accessibility state forwarding.

Chip styling must be visually distinct from full action buttons while using the same semantic color tokens.

### ListItemButton

Provide a consistent full-width row contract for settings and menu actions:

- title and optional supporting text;
- optional leading/trailing content;
- pressed and disabled states;
- optional destructive tone;
- minimum row height and spacing token;
- accessibility role forwarding.

### ModalActions

Provide consistent horizontal or vertical action layout for modal footers. The component must support cancel/secondary and confirm/primary actions, disabled/loading states, and narrow-screen wrapping without text overflow.

## Migration Strategy

1. Inventory ordinary action controls and classify each `Pressable` by semantic role.
2. Add tokens and implement the shared components with focused unit tests.
3. Migrate settings, login, cache, download, playlist management, search/detail actions, filters, and modal footers.
4. Migrate player utility and immersive icon actions where the new fixed dimensions do not conflict with custom layout.
5. Leave explicitly excluded gesture and container interactions unchanged.
6. Remove or convert duplicate local button styles after each migration batch.

Migration must preserve existing callbacks, disabled conditions, loading indicators, labels, and navigation targets.

## Accessibility and Responsive Requirements

- Every actionable control exposes an appropriate accessibility role.
- Icon-only controls expose an accessibility label.
- Touch targets remain usable on small screens.
- Text must fit inside its control; long labels may wrap only where the component contract explicitly allows it.
- Pressed and disabled states must be distinguishable in both light and dark themes.
- No component may rely on a negative letter-spacing or viewport-scaled font size.

## Verification

- Add component tests for variants, sizes, selected/disabled/loading states, and accessibility props.
- Run the mobile TypeScript check and existing test suite.
- Run the Android debug or release build after migration.
- Scan remaining ordinary `Pressable` usages and document intentional exclusions.
- Review representative screens in light and dark themes: login, settings, playlist management, download modal, search/detail, and immersive player.

## Acceptance Criteria

- Equivalent ordinary actions share the same component and semantic tokens.
- No competing generic button API remains for migrated use cases.
- Colors, heights, radii, typography, icon sizes, and press feedback are consistent across migrated screens.
- Existing behavior and navigation remain unchanged.
- Excluded custom interactions continue to work as before.
- TypeScript, tests, and Android build pass.
