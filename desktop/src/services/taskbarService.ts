import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MusicInfo } from "@lx/core";
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
import { lookupCachedCoverPath } from "@/services/mediaCache";
import { logger } from "@/services/logger";

/**
 * Windows 任务栏缩略图（鼠标悬停图标）同步服务。
 *
 * - 出向：把主窗口的播放状态与封面推给 Rust，由 Rust 换成缩略图按钮图标与预览位图。
 *   数据来源与 SMTC 服务完全一致（播放快照 + 本地封面缓存路径），不另建一套。
 * - 入向：缩略图按钮点击 → 直接调 playerStore 的现有动作，**不在这里维护播放状态机**。
 *
 * 只在主窗口挂载：音频与播放状态都在主窗口（歌词窗通过 playerSync 同步）。
 */

/**
 * 切歌后封面往往还在后台落盘（首次播放一首远程歌曲时必然如此），
 * 落盘后延时补推一次，把封面补上；只补一次。
 */
const COVER_RETRY_DELAY_MS = 2000;

/** 设置页改开关时派发的窗口事件（沿用 af-smtc-change 的写法） */
const SETTINGS_CHANGED_EVENT = "af-taskbar-change";

function trackKeyOf(music: MusicInfo | null): string {
  return music ? `${music.source}:${music.id}` : "";
}

/** 挂载任务栏缩略图同步；返回清理函数（组件卸载 / 热更新时调用） */
export function setupTaskbarThumbnails(): () => void {
  let enabled = false;
  let disposed = false;
  let lastTrackKey = "";
  let lastStatus = "";
  let coverRetryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearCoverRetry = () => {
    if (coverRetryTimer != null) {
      clearTimeout(coverRetryTimer);
      coverRetryTimer = null;
    }
  };

  /** 推送播放状态 + 封面；封面取自本地缓存，取不到就只推状态 */
  const pushTrack = async (isCoverRetry = false) => {
    const snapshot = getPlaybackSnapshotFromStore();
    const track = snapshot.current;
    // 先登记状态，避免 await 期间重复推送同一首
    lastTrackKey = trackKeyOf(track);
    lastStatus = snapshot.status;

    const coverPath = track ? await lookupCachedCoverPath(track) : null;
    if (disposed) return;

    const payload: TaskbarTrackPayload = {
      status: snapshot.status,
      coverPath,
    };
    await taskbarUpdateTrack(payload).catch((error) => {
      logger.warn("[任务栏缩略图] 推送播放状态失败", error);
    });

    // 没拿到封面且不是补推：等封面落盘后补一次
    if (!isCoverRetry && track && !coverPath) {
      const retryKey = trackKeyOf(track);
      clearCoverRetry();
      coverRetryTimer = setTimeout(() => {
        coverRetryTimer = null;
        if (disposed || trackKeyOf(getPlaybackSnapshotFromStore().current) !== retryKey) return;
        void pushTrack(true);
      }, COVER_RETRY_DELAY_MS);
    }
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
    const settings = await loadSettings().catch((error) => {
      logger.warn("[任务栏缩略图] 读取设置失败", error);
      return null;
    });
    if (disposed || !settings) return;

    // 字段缺失按默认「开」处理，与 Rust 侧 AppSettings 默认值一致
    enabled = settings.taskbarThumbnails !== false;
    await taskbarSetEnabled(enabled).catch((error) => {
      logger.warn("[任务栏缩略图] 切换开关失败", error);
    });
    if (enabled) {
      await pushTrack();
    } else {
      clearCoverRetry();
    }
  };

  const unsubscribe = usePlayerStore.subscribe(() => {
    if (!enabled || disposed) return;
    const snapshot = getPlaybackSnapshotFromStore();
    // 进度与任务栏无关（按钮图标只看状态），只在切歌 / 状态变化时推
    if (trackKeyOf(snapshot.current) !== lastTrackKey || snapshot.status !== lastStatus) {
      void pushTrack();
    }
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
    clearCoverRetry();
    unsubscribe();
    window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
    unlisten?.();
    unlisten = null;
  };
}
