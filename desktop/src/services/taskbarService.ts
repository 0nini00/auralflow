import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  TAURI_EVENTS,
  listenTauriEvent,
  taskbarSetEnabled,
  taskbarUpdateTrack,
  type TaskbarActionEvent,
  type TaskbarTrackPayload,
} from "@lx/tauri-bridge";
import { usePlayerStore } from "@/stores/playerStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getPlaybackSnapshotFromStore } from "@/services/playback/playbackSnapshot";
import { logger } from "@/services/logger";

/**
 * Windows 任务栏缩略图（鼠标悬停图标）同步服务。
 *
 * - 出向：只把主窗口的播放状态推给 Rust，由 Rust 决定播放暂停按钮画播放还是暂停。
 *   缩略图内容本身是系统按**实时窗口画面**渲染的，本服务不参与（见 Rust `src/taskbar.rs` 的模块注释）。
 * - 入向：缩略图按钮点击 → 直接调 playerStore 的现有动作，**不在这里维护播放状态机**。
 *
 * 只在主窗口挂载：音频与播放状态都在主窗口（歌词窗通过 playerSync 同步）。
 */

/** 挂载任务栏缩略图同步；返回清理函数（组件卸载 / 热更新时调用） */
export function setupTaskbarThumbnails(): () => void {
  let enabled = false;
  let disposed = false;
  /** 最近一次推给 Rust 的状态：按钮图标只看状态，没变就不必打扰原生侧 */
  let lastStatus = "";
  /** 开关应用代次：较早一次切换的原生调用晚返回时，不能再按它重推状态 */
  let applyVersion = 0;

  const pushStatus = async () => {
    if (!enabled || disposed) return;
    const status = getPlaybackSnapshotFromStore().status;
    lastStatus = status;
    const payload: TaskbarTrackPayload = { status };
    await taskbarUpdateTrack(payload).catch((error) => {
      logger.warn("[任务栏缩略图] 推送播放状态失败", error);
    });
  };

  /** 缩略图按钮 → 现有 playerStore 动作（与托盘 / 媒体键同一套） */
  const handleAction = (payload: TaskbarActionEvent) => {
    const store = usePlayerStore.getState();
    const snapshot = getPlaybackSnapshotFromStore();
    switch (payload.action) {
      case "playPause": {
        // store 没有单独的 play-pause 动作：按当前状态选暂停 / 恢复 / 重新解析
        if (!snapshot.current) return;
        if (snapshot.status === "playing") store.pause();
        else if (snapshot.status === "paused") store.resume();
        else void store.play(snapshot.current).catch(() => undefined);
        break;
      }
      case "previous":
        void store.prev().catch(() => undefined);
        break;
      case "next":
        void store.next().catch(() => undefined);
        break;
    }
  };

  /** 应用开关；打开时立刻推一次当前状态 */
  const applyEnabled = async (next: boolean) => {
    const version = ++applyVersion;
    enabled = next;
    await taskbarSetEnabled(next).catch((error) => {
      logger.warn("[任务栏缩略图] 切换开关失败", error);
    });
    if (disposed || version !== applyVersion) return;
    // 关闭再打开时状态字符串可能没变，但按钮需要按当前状态重画，所以这里无条件推一次
    lastStatus = "";
    await pushStatus();
  };

  const unsubscribe = usePlayerStore.subscribe(() => {
    if (!enabled || disposed) return;
    if (getPlaybackSnapshotFromStore().status !== lastStatus) void pushStatus();
  });

  let unlisten: UnlistenFn | null = null;
  let disposedBeforeListen = false;
  void listenTauriEvent(TAURI_EVENTS.taskbarAction, (payload) => {
    if (!enabled || disposed) return;
    handleAction(payload);
  })
    .then((fn) => {
      if (disposedBeforeListen) fn();
      else unlisten = fn;
    })
    .catch((error) => {
      logger.warn("[任务栏缩略图] 订阅按钮动作失败", error);
    });

  // 开关跟着设置走。设置还没读到（undefined）时什么都不做：读到后订阅会带着真实值触发。
  const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
    const next = state.settings?.taskbarThumbnails;
    if (next !== undefined && next !== previous.settings?.taskbarThumbnails) void applyEnabled(next);
  });
  const initial = useSettingsStore.getState().settings?.taskbarThumbnails;
  if (initial !== undefined) void applyEnabled(initial);

  return () => {
    disposed = true;
    disposedBeforeListen = true;
    unsubscribe();
    unsubscribeSettings();
    unlisten?.();
    unlisten = null;
  };
}
