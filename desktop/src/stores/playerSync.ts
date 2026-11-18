import { emit, listen } from "@tauri-apps/api/event";
import type { PlaybackSnapshot } from "@/services/playback/playbackSnapshotModel";
import { applyPlaybackSnapshotToMirror } from "./playbackMirrorStore";

/**
 * 主窗口与副窗口（桌面歌词 / 迷你播放器）之间的播放同步通道，以及副窗口这一端。
 *
 * 主窗口那一端在 playerSyncMain.ts：它要读 playerStore、执行播放动作，只由主窗口加载。
 * 本模块会被副窗口加载，所以**不能依赖 playerStore**（tests/window-dependency.test.ts 锁着）。
 */

const CHANNEL_NAME = "auralflow-player-sync";
/** 状态快照使用双通道；控制动作只走 Tauri，避免一次点击被执行两次。 */
export const PLAYER_SYNC_TAURI_EVENT = "auralflow-player-sync";

export type PlayerSyncAction = "play-pause" | "next" | "prev";

export type SyncMessage =
  | { type: "state"; snapshot: PlaybackSnapshot }
  | { type: "action"; action: PlayerSyncAction }
  | { type: "request-state" };

let channelInstance: BroadcastChannel | null = null;
export function getPlayerSyncChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channelInstance) {
    channelInstance = new BroadcastChannel(CHANNEL_NAME);
  }
  return channelInstance;
}

export function postSyncMessage(channel: BroadcastChannel | null, message: SyncMessage) {
  if (message.type === "action") {
    void emit(PLAYER_SYNC_TAURI_EVENT, message).catch((error) => {
      console.error('[player-sync] 歌词控制动作发送失败', error);
    });
    return;
  }
  try {
    channel?.postMessage(message);
  } catch (error) {
    // BroadcastChannel 在消息不可序列化时会抛（结构化克隆限制）。
    // 不能静默：状态快照发不出去时歌词窗口会停在旧状态，与主窗不同步，
    // 而这种症状从界面上看不出原因。
    console.error('[player-sync] BroadcastChannel 发送播放状态失败，改由 Tauri 事件兜底', error);
  }
  // 状态消息保留双通道，提高跨 WebView 到达可靠性；动作不在此发送。
  void emit(PLAYER_SYNC_TAURI_EVENT, message).catch(() => undefined);
}

// ─── 副窗口（桌面歌词 / 迷你播放器）──────────────────────────

/** 已应用的最新快照时刻：两条通道（BroadcastChannel + Tauri 事件）到达顺序不保证，
 *  旧快照晚到会把新状态写回去（歌词窗闪回上一首）。 */
let lastAppliedUpdatedAt = 0;

function applyState(snapshot: PlaybackSnapshot) {
  if (Number.isFinite(snapshot.updatedAt) && snapshot.updatedAt < lastAppliedUpdatedAt) return;
  if (Number.isFinite(snapshot.updatedAt)) lastAppliedUpdatedAt = snapshot.updatedAt;
  applyPlaybackSnapshotToMirror(snapshot);
}

let secondaryInitialized = false;
/** 副窗口的界面挂载时调用：开始接收主窗口的播放状态，并主动要一次当前状态。幂等。 */
export function setupSecondaryPlayerSync() {
  if (secondaryInitialized) return;
  secondaryInitialized = true;
  const channel = getPlayerSyncChannel();

  channel?.addEventListener("message", (event) => {
    const msg = event.data as SyncMessage;
    if (msg.type !== "state") return;
    applyState(msg.snapshot);
  });

  void listen<SyncMessage>(PLAYER_SYNC_TAURI_EVENT, (event) => {
    const msg = event.payload;
    if (!msg || msg.type !== "state") return;
    applyState(msg.snapshot);
  }).catch(() => undefined);

  // 启动时主动请求一次状态（双通道）
  postSyncMessage(channel, { type: "request-state" });
}

/** 在副窗口里调用，把 action 发给主窗口执行 */
export function dispatchLyricAction(action: PlayerSyncAction) {
  postSyncMessage(getPlayerSyncChannel(), { type: "action", action });
}
