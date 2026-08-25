export interface NativeFullscreenState {
  isFullscreen: boolean;
  ownedByImmersive: boolean;
}

export function createNativeFullscreenState(): NativeFullscreenState {
  return { isFullscreen: false, ownedByImmersive: false };
}

export function observeNativeFullscreen(
  state: NativeFullscreenState,
  isFullscreen: boolean,
): NativeFullscreenState {
  return {
    isFullscreen,
    ownedByImmersive: isFullscreen ? state.ownedByImmersive : false,
  };
}

export function claimFullscreenTransition(
  state: NativeFullscreenState,
  isFullscreen: boolean,
): NativeFullscreenState {
  const next = {
    isFullscreen,
    ownedByImmersive: isFullscreen && (state.ownedByImmersive || !state.isFullscreen),
  };
  if (state.isFullscreen === next.isFullscreen && state.ownedByImmersive === next.ownedByImmersive) {
    return state;
  }
  return next;
}

export function applyNativeFullscreenTransition(
  state: NativeFullscreenState,
  wasFullscreen: boolean,
  isFullscreen: boolean,
): NativeFullscreenState {
  return claimFullscreenTransition(
    observeNativeFullscreen(state, wasFullscreen),
    isFullscreen,
  );
}

export function shouldExitOwnedFullscreen(state: NativeFullscreenState): boolean {
  return state.isFullscreen && state.ownedByImmersive;
}

export interface NativeFullscreenObservationGate {
  begin(): number;
  invalidate(): void;
  isCurrent(token: number): boolean;
}

export function createNativeFullscreenObservationGate(): NativeFullscreenObservationGate {
  let revision = 0;

  return {
    begin: () => {
      revision += 1;
      return revision;
    },
    invalidate: () => {
      revision += 1;
    },
    isCurrent: (token) => token === revision,
  };
}
