import { describe, expect, it } from 'vitest';
import {
  applyNativeFullscreenTransition,
  claimFullscreenTransition,
  createNativeFullscreenObservationGate,
  createNativeFullscreenState,
  observeNativeFullscreen,
  shouldExitOwnedFullscreen,
} from './nativeFullscreenModel';

describe('native fullscreen ownership', () => {
  it('does not claim fullscreen entered outside the immersive page', () => {
    const state = observeNativeFullscreen(createNativeFullscreenState(), true);
    expect(state).toEqual({ isFullscreen: true, ownedByImmersive: false });
    expect(shouldExitOwnedFullscreen(state)).toBe(false);
  });

  it('does not steal ownership when fullscreen was already active externally', () => {
    const external = observeNativeFullscreen(createNativeFullscreenState(), true);
    const unchanged = claimFullscreenTransition(external, true);
    expect(unchanged).toEqual({ isFullscreen: true, ownedByImmersive: false });
    expect(shouldExitOwnedFullscreen(unchanged)).toBe(false);
  });

  it('uses the actual pre-transition state when the stored observation is stale', () => {
    const stale = observeNativeFullscreen(createNativeFullscreenState(), true);
    const entered = applyNativeFullscreenTransition(stale, false, true);
    expect(entered).toEqual({ isFullscreen: true, ownedByImmersive: true });
    expect(shouldExitOwnedFullscreen(entered)).toBe(true);
  });

  it('owns fullscreen entered by the immersive page', () => {
    const state = claimFullscreenTransition(createNativeFullscreenState(), true);
    expect(state).toEqual({ isFullscreen: true, ownedByImmersive: true });
    expect(shouldExitOwnedFullscreen(state)).toBe(true);
  });

  it('clears ownership when fullscreen exits externally', () => {
    const owned = claimFullscreenTransition(createNativeFullscreenState(), true);
    const exited = observeNativeFullscreen(owned, false);
    expect(exited).toEqual({ isFullscreen: false, ownedByImmersive: false });
    expect(shouldExitOwnedFullscreen(exited)).toBe(false);
  });
});

describe('native fullscreen observation gate', () => {
  it('accepts only the latest observation and invalidates pending reads during transitions', () => {
    const gate = createNativeFullscreenObservationGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(second)).toBe(false);
  });
});
