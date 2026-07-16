import {
  getLyricWindowState,
  setLyricWindowLocked,
  toggleLyricWindow,
  toggleLyricWindowFromPlayer,
  unlockLyricWindowFromPlayer,
  type RustLyricWindowPlayerToggleResult,
  type RustLyricWindowPlayerUnlockResult,
  type RustLyricWindowState,
} from "@lx/tauri-bridge";
import { broadcastLyricSettings } from "@/stores/lyricSettingsSync";

export type DesktopLyricPlayerToggleAction = "opened" | "closed" | "unlocked";

export interface DesktopLyricPlayerToggleResult {
  action: DesktopLyricPlayerToggleAction;
  open: boolean;
  locked: boolean;
  message: string;
}

export interface DesktopLyricPlayerToggleContext {
  knownOpen?: boolean;
  knownLocked?: boolean;
  setLocked?: (locked: boolean) => Promise<unknown>;
  broadcastSettings?: typeof broadcastLyricSettings;
  getState?: () => Promise<RustLyricWindowState>;
  unlockFirst?: () => Promise<RustLyricWindowPlayerUnlockResult>;
  stateQueryTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (typeof globalThis.setTimeout !== "function" || typeof globalThis.clearTimeout !== "function") {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(new Error(`desktop lyric state query timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export async function toggleDesktopLyricFromPlayer(
  toggleCommand: () => Promise<RustLyricWindowPlayerToggleResult> = toggleLyricWindowFromPlayer,
  context: DesktopLyricPlayerToggleContext = {},
): Promise<DesktopLyricPlayerToggleResult> {
  const setLocked = context.setLocked ?? ((locked: boolean) => setLyricWindowLocked(locked, undefined, "player-helper"));
  const broadcastSettings = context.broadcastSettings ?? broadcastLyricSettings;
  let backendState: RustLyricWindowState | null = null;

  try {
    const unlockResult = await withTimeout(
      (context.unlockFirst ?? unlockLyricWindowFromPlayer)(),
      context.stateQueryTimeoutMs ?? 700,
    );
    if (unlockResult.unlocked) {
      broadcastSettings({ lyricLocked: false });
      return {
        action: "unlocked",
        open: true,
        locked: false,
        message: "桌面歌词已解锁",
      };
    }
  } catch (error) {
    console.warn("[desktop lyric] unlock-first command failed, falling back", error);
  }

  try {
    backendState = await withTimeout(
      (context.getState ?? getLyricWindowState)(),
      context.stateQueryTimeoutMs ?? 700,
    );
  } catch (error) {
    console.warn("[desktop lyric] query lyric state failed, falling back", error);
  }

  const shouldUnlock = Boolean(backendState?.locked || context.knownLocked);

  if (shouldUnlock) {
    await setLocked(false);
    broadcastSettings({ lyricLocked: false });
    return {
      action: "unlocked",
      open: true,
      locked: false,
      message: "桌面歌词已解锁",
    };
  }

  if (!backendState && context.knownOpen) {
    await setLocked(false);
    broadcastSettings({ lyricLocked: false });
    return {
      action: "unlocked",
      open: true,
      locked: false,
      message: "桌面歌词已解锁",
    };
  }

  try {
    return await toggleCommand();
  } catch (error) {
    console.warn("[desktop lyric] lock-aware toggle command failed, falling back", error);
  }

  if (Boolean(backendState?.open || context.knownOpen)) {
    await setLocked(false);
    broadcastSettings({ lyricLocked: false });
    return {
      action: "unlocked",
      open: true,
      locked: false,
      message: "桌面歌词已解锁",
    };
  }

  const nextOpen = await toggleLyricWindow();
  return {
    action: nextOpen ? "opened" : "closed",
    open: nextOpen,
    locked: false,
    message: nextOpen ? "桌面歌词已打开" : "桌面歌词已关闭",
  };
}
