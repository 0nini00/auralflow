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
import { logger } from "@/services/logger";

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
    // 解锁探测失败是预期分支（窗口未开 / IPC 超时）：继续往下按「后端没报告锁定」处理。
    // 但必须留痕——否则「点了歌词按钮却只关掉窗口没解锁」这种情况无从排查。
    logger.debug("[桌面歌词] 解锁探测失败，按未锁定继续", error);
  }

  try {
    backendState = await withTimeout(
      (context.getState ?? getLyricWindowState)(),
      context.stateQueryTimeoutMs ?? 700,
    );
  } catch (error) {
    // 状态查询超时/失败：backendState 保持 null，下面的判断只信 knownLocked。
    // 不能把「查不到」当成「未锁定」以外的结论（那会让已锁定窗口被误关），
    // 也不能静默——同一处失败若持续发生，用户看到的是「按钮点了但要再点一次才生效」。
    logger.debug("[桌面歌词] 窗口状态查询失败，本次只依据调用方缓存判断", error);
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
