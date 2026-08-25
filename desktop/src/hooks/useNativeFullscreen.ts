import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  applyNativeFullscreenTransition,
  createNativeFullscreenObservationGate,
  createNativeFullscreenState,
  observeNativeFullscreen,
  shouldExitOwnedFullscreen,
  type NativeFullscreenState,
} from './nativeFullscreenModel';

interface NativeFullscreenController {
  isFullscreen: boolean;
  toggleFullscreen: () => Promise<void>;
}

export function useNativeFullscreen(open: boolean): NativeFullscreenController {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stateRef = useRef<NativeFullscreenState>(createNativeFullscreenState());
  const observationGateRef = useRef(createNativeFullscreenObservationGate());
  const windowRef = useRef<ReturnType<typeof getCurrentWindow> | null>(null);

  const syncFromWindow = useCallback(async (appWindow: ReturnType<typeof getCurrentWindow>) => {
    const observationToken = observationGateRef.current.begin();
    const actual = await appWindow.isFullscreen();
    if (!observationGateRef.current.isCurrent(observationToken)) return;
    stateRef.current = observeNativeFullscreen(stateRef.current, actual);
    setIsFullscreen(actual);
  }, []);

  useEffect(() => {
    if (!open) return;

    const appWindow = getCurrentWindow();
    windowRef.current = appWindow;
    let disposed = false;
    let removeResizeListener: (() => void) | undefined;
    let removeFocusListener: (() => void) | undefined;
    const refresh = () => {
      if (!disposed) void syncFromWindow(appWindow).catch(() => undefined);
    };

    refresh();
    void appWindow.onResized(refresh).then((remove) => {
      if (disposed) remove();
      else removeResizeListener = remove;
    });
    void appWindow.onFocusChanged(refresh).then((remove) => {
      if (disposed) remove();
      else removeFocusListener = remove;
    });

    return () => {
      disposed = true;
      observationGateRef.current.invalidate();
      removeResizeListener?.();
      removeFocusListener?.();
      windowRef.current = null;
      if (!shouldExitOwnedFullscreen(stateRef.current)) return;
      stateRef.current = createNativeFullscreenState();
      setIsFullscreen(false);
      void appWindow.setFullscreen(false).catch(() => undefined);
    };
  }, [open, syncFromWindow]);

  const toggleFullscreen = useCallback(async () => {
    const appWindow = windowRef.current ?? getCurrentWindow();
    observationGateRef.current.invalidate();
    const current = await appWindow.isFullscreen();
    const next = !current;
    await appWindow.setFullscreen(next);
    observationGateRef.current.invalidate();
    stateRef.current = applyNativeFullscreenTransition(stateRef.current, current, next);
    setIsFullscreen(next);
  }, []);

  return { isFullscreen, toggleFullscreen };
}
