import { listen } from "@tauri-apps/api/event";
import { usePlayerStore } from "./playerStore";
import { dispatchPlaybackAction } from "@/services/playback/playbackActions";
import { getPlaybackSnapshotFromStore } from "@/services/playback/playbackSnapshot";
import {
  PLAYER_SYNC_TAURI_EVENT,
  getPlayerSyncChannel,
  postSyncMessage,
  type SyncMessage,
} from "./playerSync";

/**
 * 播放同步的主窗口一端：把 playerStore 的变化广播给副窗口，并执行副窗口发回的控件动作。
 * 只由主窗口加载（MainWindow.tsx）；通道与副窗口一端见 playerSync.ts。
 */

let initialized = false;
/** 主窗口挂载时调用一次。幂等；监听随应用存活，不拆除。 */
export function setupMainPlayerSync() {
  if (initialized) return;
  initialized = true;
  const channel = getPlayerSyncChannel();

  // 收到副窗口的 action / request-state
  const onMessage = (msg: SyncMessage) => {
    if (msg.type === "action") {
      // 统一分发（与托盘 / SMTC 同语义），见 playbackActions
      dispatchPlaybackAction(msg.action);
      return;
    }
    if (msg.type === "request-state") {
      const snapshot = getPlaybackSnapshotFromStore();
      postSyncMessage(channel, { type: "state", snapshot });
    }
  };

  channel?.addEventListener("message", (event) => {
    const message = event.data as SyncMessage;
    // request-state 不在这里处理：postSyncMessage 双通道发送，启动握手统一走
    // 更可靠的 Tauri 事件通道，否则同一次请求会被应答两遍、状态快照推两遍。
    if (!message || message.type === "state" || message.type === "request-state") return;
    onMessage(message);
  });

  void listen<SyncMessage>(PLAYER_SYNC_TAURI_EVENT, (event) => {
    // 忽略自己发出的状态广播，只处理副窗口发来的 action / request-state。
    // request-state（启动握手）统一由这条 Tauri 事件通道处理：postSyncMessage
    // 双通道发送，BroadcastChannel 侧已跳过，避免状态快照被推两遍。
    const msg = event.payload;
    if (!msg || msg.type === "state") return;
    onMessage(msg);
  }).catch(() => undefined);

  // 订阅 store 变化，推送给副窗口
  // 进度类高频字段做轻量节流，降低副窗口 setState 压力
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

  usePlayerStore.subscribe(() => {
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
}
