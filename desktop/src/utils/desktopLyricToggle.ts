import {
  getLyricWindowState,
  setLyricWindowLocked,
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
  }

  try {
    backendState = await withTimeout(
      (context.getState ?? getLyricWindowState)(),
      context.stateQueryTimeoutMs ?? 700,
    );
  } catch (error) {
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

  // 状态查询失败时不能把前端旧状态当成后端事实，否则窗口已关闭时会被误判为“已打开”。
  // 只有后端明确报告锁定，或明确的 knownLocked，才执行解锁。
  const result = await toggleCommand();
  broadcastSettings({ lyricLocked: result.locked });
  return result;
}
