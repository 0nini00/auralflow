/**
 * 桌面歌词独立窗口的跨窗口状态同步。
 *
 * 主窗口（source of truth）持有真实 audio + store；
 * 歌词窗口只渲染，按钮按下用 BroadcastChannel 转发给主窗口执行。
 *
 * 由 window.location.hash 决定本窗口角色：
 *   `#/lyric` → 歌词窗口（receiver + action sender）
 *   其他 → 主窗口（state sender + action receiver）
 */

import { usePlayerStore } from "./playerStore";
import { detectWindowRoleFromParts } from "@/utils/windowRole";
import { logAsyncError } from "@/utils/logAsyncError";
import {
  applyPlaybackSnapshotToStorePatch,
  getPlaybackSnapshotFromStore,
  type PlaybackSnapshot,
  type PlaybackSnapshotSource,
} from "@/services/playback/playbackSnapshot";

const CHANNEL_NAME = "auralflow-player-sync";

export type PlayerSyncRole = "main" | "lyric";

export function detectRole(): PlayerSyncRole {
  if (typeof window === "undefined") return "main";
  const role = detectWindowRoleFromParts(undefined, window.location.hash);
  return role === "lyric" ? "lyric" : "main";
}

// ─── 同步消息类型 ────────────────────────────────

type SyncMessage =
  | { type: "state"; snapshot: PlaybackSnapshot }
  | { type: "action"; action: "play-pause" | "next" | "prev" }
  | { type: "request-state" };

// ─── 主窗口：广播状态 + 接收 action ────────────────

function buildCriticalBroadcastKey(source: Pick<
  PlaybackSnapshotSource,
  "current" | "status" | "duration" | "playbackRate" | "error"
>): string {
  const currentKey = source.current
    ? `${source.current.source}:${source.current.id}`
    : "";
  return [
    currentKey,
    source.status,
    source.duration,
    source.playbackRate,
    source.error ?? "",
  ].join("\u001f");
}

function setupMainWindow(channel: BroadcastChannel) {
  let lastBroadcast = 0;
  let lastCriticalBroadcastKey = "";
  const broadcastState = (force = false) => {
    const now = performance.now();
    const snapshot = getPlaybackSnapshotFromStore();
    const criticalKey = buildCriticalBroadcastKey(snapshot);
    const criticalChanged = criticalKey !== lastCriticalBroadcastKey;
    // 限频：200ms 一次足够歌词跟随，减少歌词窗口不必要的 setState
    if (!force && !criticalChanged && now - lastBroadcast < 200) return;
    lastBroadcast = now;
    lastCriticalBroadcastKey = criticalKey;
    const message: SyncMessage = {
      type: "state",
      snapshot,
    };
    channel.postMessage(message);
  };

  // 订阅 store 变化（progress 每 raf 更新一次），listener 参数不是 force 标记。
  usePlayerStore.subscribe(() => broadcastState(false));

  // 接收歌词窗口的 action
  channel.addEventListener("message", (event) => {
    const msg = event.data as SyncMessage;
    const store = usePlayerStore.getState();
    switch (msg.type) {
      case "request-state":
        broadcastState(true);
        break;
      case "action":
        if (msg.action === "play-pause") {
          if (!store.current) return;
          if (store.status === "playing") store.pause();
          else if (store.status === "paused") store.resume();
          else void store.play(store.current).catch(logAsyncError("player-sync:play"));
        } else if (msg.action === "next") {
          void store.next().catch(logAsyncError("player-sync:next"));
        } else if (msg.action === "prev") {
          void store.prev().catch(logAsyncError("player-sync:prev"));
        }
        break;
    }
  });

  broadcastState(true);
}

// ─── 歌词窗口：接收状态 + 派 action ────────────────

function setupLyricWindow(channel: BroadcastChannel) {
  // 收到主窗口状态时，写入本窗口 store（只更新只读字段）
  channel.addEventListener("message", (event) => {
    const msg = event.data as SyncMessage;
    if (msg.type !== "state") return;
    usePlayerStore.setState(applyPlaybackSnapshotToStorePatch(msg.snapshot));
  });

  // 启动时主动请求一次状态
  const askInit: SyncMessage = { type: "request-state" };
  channel.postMessage(askInit);
}

/** 在歌词窗口里调用，把 action 发给主窗口执行 */
export function dispatchLyricAction(action: "play-pause" | "next" | "prev") {
  const channel = getChannel();
  const message: SyncMessage = { type: "action", action };
  channel.postMessage(message);
}

// ─── 单例 channel ────────────────────────────────

let channelInstance: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel {
  if (!channelInstance) {
    channelInstance = new BroadcastChannel(CHANNEL_NAME);
  }
  return channelInstance;
}

let initializedRole: PlayerSyncRole | null = null;
/** 在 App.tsx 确认窗口角色后调用一次 */
export function setupPlayerSync(role: PlayerSyncRole = detectRole()) {
  if (initializedRole) return;
  initializedRole = role;
  const channel = getChannel();
  if (role === "lyric") {
    setupLyricWindow(channel);
  } else {
    setupMainWindow(channel);
  }
}
