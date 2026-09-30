import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MusicInfo } from "@lx/core";
import {
  SMTC_ACTION_EVENT,
  loadSettings,
  smtcSetEnabled,
  smtcUpdateProgress,
  smtcUpdateTrack,
  type SmtcActionEvent,
  type SmtcTrackPayload,
} from "@lx/tauri-bridge";
import { usePlayerStore } from "@/stores/playerStore";
import { getPlaybackSnapshotFromStore } from "@/services/playback/playbackSnapshot";
import { lookupCachedCoverPath } from "@/services/mediaCache";
import { logger } from "@/services/logger";

/**
 * Windows 系统媒体控制（SMTC）同步服务。
 *
 * - 出向：把主窗口的播放状态 / 曲目 / 进度推给系统（媒体键、系统浮层、锁屏）。
 *   节流由 Rust 侧负责（≥500ms），这里只做「变化了才发」的最低门槛。
 * - 入向：系统按钮 → 直接调 playerStore 的现有动作，**不在这里维护播放状态机**。
 *
 * 只在主窗口挂载：音频与播放状态都在主窗口（歌词窗通过 playerSync 同步）。
 */

/** 进度推送本地门槛（秒）：再细没有意义，Rust 侧还有 500ms 节流兜底 */
const PROGRESS_PUSH_STEP_SECONDS = 0.5;

/**
 * 切歌后封面往往还在后台落盘（首次播放一首远程歌曲时必然如此），
 * 落盘后延时补推一次，把封面补上；只补一次。
 */
const COVER_RETRY_DELAY_MS = 2000;

/** 设置页改开关时派发的窗口事件（沿用 af-cursor-change 的写法） */
const SETTINGS_CHANGED_EVENT = "af-smtc-change";

function trackKeyOf(music: MusicInfo | null): string {
  return music ? `${music.source}:${music.id}` : "";
}

/** 挂载系统媒体控制同步；返回清理函数（组件卸载 / 热更新时调用） */
export function setupSystemMediaControls(): () => void {
  let enabled = false;
  let disposed = false;
  let lastTrackKey = "";
  let lastStatus = "";
  let lastProgress = -1;
  let coverRetryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearCoverRetry = () => {
    if (coverRetryTimer != null) {
      clearTimeout(coverRetryTimer);
      coverRetryTimer = null;
    }
  };

  /** 推送曲目 + 播放状态；封面取自本地缓存，取不到就只推文字 */
  const pushTrack = async (isCoverRetry = false) => {
    const snapshot = getPlaybackSnapshotFromStore();
    const track = snapshot.current;
    // 先登记状态，避免 await 期间重复推送同一首
    lastTrackKey = trackKeyOf(track);
    lastStatus = snapshot.status;
    lastProgress = snapshot.progress;

    const coverPath = track ? await lookupCachedCoverPath(track) : null;
    if (disposed) return;

    const payload: SmtcTrackPayload = {
      status: snapshot.status,
      title: track?.name ?? "",
      artist: track?.singer ?? "",
      album: track?.albumName ?? "",
      duration: snapshot.duration,
      position: snapshot.progress,
      coverPath,
    };
    await smtcUpdateTrack(payload).catch((error) => {
      logger.warn("[系统媒体控制] 推送曲目失败", error);
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

  /** 系统侧动作 → 现有 playerStore 动作 */
  const handleAction = (payload: SmtcActionEvent) => {
    const store = usePlayerStore.getState();
    const snapshot = getPlaybackSnapshotFromStore();
    switch (payload.action) {
      case "play": {
        // store 没有单独的 play 动作：按当前状态选 resume 还是重新解析（与托盘/媒体键同一套）
        if (!snapshot.current || snapshot.status === "playing") return;
        if (snapshot.status === "paused") store.resume();
        else void store.play(snapshot.current).catch(() => undefined);
        break;
      }
      case "pause":
        store.pause();
        break;
      case "stop":
        store.stop();
        break;
      case "next":
        void store.next().catch(() => undefined);
        break;
      case "previous":
        void store.prev().catch(() => undefined);
        break;
      case "seek": {
        const position = payload.position;
        if (typeof position === "number" && Number.isFinite(position)) {
          store.setProgress(position);
        }
        break;
      }
    }
  };

  /** 读取设置并应用开关；打开时立刻推一次当前曲目 */
  const applySettings = async () => {
    const settings = await loadSettings().catch((error) => {
      logger.warn("[系统媒体控制] 读取设置失败", error);
      return null;
    });
    if (disposed || !settings) return;

    // 字段缺失按默认「开」处理，与 Rust 侧 AppSettings 默认值一致
    enabled = settings.followSystemMediaControl !== false;
    await smtcSetEnabled(enabled).catch((error) => {
      logger.warn("[系统媒体控制] 切换开关失败", error);
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

    if (trackKeyOf(snapshot.current) !== lastTrackKey || snapshot.status !== lastStatus) {
      void pushTrack();
      return;
    }
    if (Math.abs(snapshot.progress - lastProgress) >= PROGRESS_PUSH_STEP_SECONDS) {
      lastProgress = snapshot.progress;
      void smtcUpdateProgress(snapshot.progress, snapshot.duration).catch((error) => {
        logger.warn("[系统媒体控制] 推送进度失败", error);
      });
    }
  });

  let unlisten: UnlistenFn | null = null;
  let disposedBeforeListen = false;
  void listen<SmtcActionEvent>(SMTC_ACTION_EVENT, (event) => {
    if (!enabled || disposed) return;
    handleAction(event.payload);
  })
    .then((fn) => {
      if (disposedBeforeListen) fn();
      else unlisten = fn;
    })
    .catch((error) => {
      logger.warn("[系统媒体控制] 订阅系统动作失败", error);
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
