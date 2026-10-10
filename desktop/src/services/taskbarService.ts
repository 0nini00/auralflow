import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  TASKBAR_ACTION_EVENT,
  loadSettings,
  taskbarSetEnabled,
  taskbarUpdateTrack,
  type TaskbarActionEvent,
  type TaskbarTrackPayload,
} from "@lx/tauri-bridge";
import { usePlayerStore } from "@/stores/playerStore";
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

/** 设置页改开关时派发的窗口事件（沿用 af-smtc-change 的写法） */
const SETTINGS_CHANGED_EVENT = "af-taskbar-change";

/** 挂载任务栏缩略图同步；返回清理函数（组件卸载 / 热更新时调用） */
export function setupTaskbarThumbnails(): () => void {
  let enabled = false;
  let disposed = false;
  /** 最近一次推给 Rust 的状态：按钮图标只看状态，没变就不必打扰原生侧 */
  let lastStatus = "";
  /** 设置读取代次：旧响应晚返回时不能覆盖更新的设置 */
  let settingsRequestVersion = 0;

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

  /** 读取设置并应用开关；打开时立刻推一次当前状态 */
  const applySettings = async () => {
    const settingsVersion = ++settingsRequestVersion;
    const settings = await loadSettings().catch((error) => {
      logger.warn("[任务栏缩略图] 读取设置失败", error);
      return null;
    });
    if (disposed || settingsVersion !== settingsRequestVersion || !settings) return;

    // 字段缺失按默认「开」处理，与 Rust 侧 AppSettings 默认值一致
    enabled = settings.taskbarThumbnails !== false;
    await taskbarSetEnabled(enabled).catch((error) => {
      logger.warn("[任务栏缩略图] 切换开关失败", error);
    });
    if (disposed || settingsVersion !== settingsRequestVersion) return;
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
  void listen<TaskbarActionEvent>(TASKBAR_ACTION_EVENT, (event) => {
    if (!enabled || disposed) return;
    handleAction(event.payload);
  })
    .then((fn) => {
      if (disposedBeforeListen) fn();
      else unlisten = fn;
    })
    .catch((error) => {
      logger.warn("[任务栏缩略图] 订阅按钮动作失败", error);
    });

  const onSettingsChanged = () => {
    void applySettings();
  };
  window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
  void applySettings();

  return () => {
    disposed = true;
    disposedBeforeListen = true;
    unsubscribe();
    window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
    unlisten?.();
    unlisten = null;
  };
}
