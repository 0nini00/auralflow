import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePlayerStore } from "./playerStore";
import {
  applyPlaybackSnapshotToStorePatch,
  getPlaybackSnapshotFromStore,
  type PlaybackSnapshot,
} from "@/services/playback/playbackSnapshot";
import { logAsyncError } from "@/utils/logAsyncError";
import type { AppWindowRole } from "@/utils/windowRole";

const CHANNEL_NAME = "auralflow-player-sync";
/** Tauri event fallback when BroadcastChannel is unavailable across webviews */
const TAURI_EVENT = "auralflow-player-sync";

type SyncMessage =
  | { type: "state"; snapshot: PlaybackSnapshot }
  | { type: "action"; action: "play-pause" | "next" | "prev" }
  | { type: "request-state" };

// ─── Main window ─────────────────────────────────────────────

function handleAction(action: "play-pause" | "next" | "prev") {
  const store = usePlayerStore.getState();
  const snapshot = getPlaybackSnapshotFromStore();
  switch (action) {
    case "play-pause": {
      if (!snapshot.current) return;
      if (snapshot.status === "playing") store.pause();
      else if (snapshot.status === "paused") store.resume();
      else void store.play(snapshot.current).catch(logAsyncError("player-sync:play"));
      break;
    }
    case "next":
      void store.next().catch(logAsyncError("player-sync:next"));
      break;
    case "prev":
      void store.prev().catch(logAsyncError("player-sync:prev"));
      break;
  }
}

function postSyncMessage(channel: BroadcastChannel | null, message: SyncMessage) {
  try {
    channel?.postMessage(message);
  } catch (err) {
    logAsyncError("player-sync:broadcast")(err);
  }
  // Dual channel: also emit via Tauri for cross-webview reliability
  void emit(TAURI_EVENT, message).catch(logAsyncError("player-sync:tauri-emit"));
}

function setupMainWindow(channel: BroadcastChannel | null) {
  // 收到歌词窗口的 action / request-state
  const onMessage = (msg: SyncMessage) => {
    if (msg.type === "action") {
      handleAction(msg.action);
      return;
    }
    if (msg.type === "request-state") {
      const snapshot = getPlaybackSnapshotFromStore();
      postSyncMessage(channel, { type: "state", snapshot });
    }
  };

  channel?.addEventListener("message", (event) => {
    onMessage(event.data as SyncMessage);
  });

  let unlistenTauri: UnlistenFn | null = null;
  void listen<SyncMessage>(TAURI_EVENT, (event) => {
    // Ignore our own state broadcasts; only handle inbound action/request
    const msg = event.payload;
    if (!msg || msg.type === "state") return;
    onMessage(msg);
  })
    .then((unlisten) => {
      unlistenTauri = unlisten;
    })
    .catch(logAsyncError("player-sync:main-listen"));

  // 订阅 store 变化，推送给歌词窗口
  // 进度类高频字段做轻量节流，降低歌词窗 setState 压力
  let lastProgressSent = -1;
  let lastStatus = "";
  let lastTrackKey = "";
  let progressTimer: ReturnType<typeof setTimeout> | null = null;

  const flushState = () => {
    progressTimer = null;
    const snapshot = getPlaybackSnapshotFromStore();
    postSyncMessage(channel, { type: "state", snapshot });
    lastProgressSent = snapshot.progress;
    lastStatus = snapshot.status;
    lastTrackKey = snapshot.current
      ? `${snapshot.current.source}:${snapshot.current.id}`
      : "";
  };

  const unsub = usePlayerStore.subscribe(() => {
    const snapshot = getPlaybackSnapshotFromStore();
    const trackKey = snapshot.current
      ? `${snapshot.current.source}:${snapshot.current.id}`
      : "";
    const statusChanged = snapshot.status !== lastStatus;
    const trackChanged = trackKey !== lastTrackKey;
    const progressDelta = Math.abs(snapshot.progress - lastProgressSent);

    // 切歌 / 状态变化立刻推；纯进度变化节流到 ~200ms 或进度差 >= 0.4s
    if (statusChanged || trackChanged || progressDelta >= 0.4) {
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      flushState();
      return;
    }
    if (progressTimer == null) {
      progressTimer = setTimeout(flushState, 200);
    }
  });

  // 启动时先推一次
  flushState();

  // unsub kept for potential future teardown; windows live for app lifetime
  void unsub;
  void unlistenTauri;
}

// ─── Lyric window ────────────────────────────────────────────

function applyState(snapshot: PlaybackSnapshot) {
  usePlayerStore.setState(applyPlaybackSnapshotToStorePatch(snapshot));
}

function setupLyricWindow(channel: BroadcastChannel | null) {
  channel?.addEventListener("message", (event) => {
    const msg = event.data as SyncMessage;
    if (msg.type !== "state") return;
    applyState(msg.snapshot);
  });

  void listen<SyncMessage>(TAURI_EVENT, (event) => {
    const msg = event.payload;
    if (!msg || msg.type !== "state") return;
    applyState(msg.snapshot);
  }).catch(logAsyncError("player-sync:lyric-listen"));

  // 启动时主动请求一次状态（双通道）
  const askInit: SyncMessage = { type: "request-state" };
  postSyncMessage(channel, askInit);
}

/** 在歌词窗口里调用，把 action 发给主窗口执行 */
export function dispatchLyricAction(action: "play-pause" | "next" | "prev") {
  const message: SyncMessage = { type: "action", action };
  postSyncMessage(getChannel(), message);
}

// ─── 单例 channel ────────────────────────────────

let channelInstance: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channelInstance) {
    channelInstance = new BroadcastChannel(CHANNEL_NAME);
  }
  return channelInstance;
}

let initialized = false;
/** 在 App.tsx 确认窗口角色后调用一次 */
export function setupPlayerSync(role: AppWindowRole = "main") {
  if (initialized) return;
  initialized = true;
  const channel = getChannel();
  if (role === "lyric") {
    setupLyricWindow(channel);
  } else {
    // main / lyric-unlock 都不作为歌词同步接收端
    setupMainWindow(channel);
  }
}
