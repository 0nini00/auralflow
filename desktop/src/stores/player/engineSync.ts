/**
 * 播放引擎事件到 store 的同步：状态 / 进度推送、听歌统计采样、出错自动跳、
 * 播完续播、试听片段兜底。两个函数都只在创建 store 时各调用一次。
 */
import { debugLog } from "@lx/tauri-bridge";
import { removeCachedAudioForMusic } from "@/services/mediaCache";
import { invalidateCachedPlaybackUrl } from "@/services/persistentCache";
import { invalidatePrefetchedTrack } from "@/services/playback/prefetchService";
import { playerEngine } from "@/services/playerEngine";
import { finishListeningStats, pauseListeningStats, registerListeningStatsSampler, startListeningStats, sampleListeningStats } from "@/stores/listeningStatsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSleepTimerStore } from "@/stores/sleepTimerStore";
import { getLocalPlaybackMusic, invalidatePersistentPlaybackCache } from "./playbackPipeline";
import { buildPlayRequestKey, getEngineTargetKey, setEngineTargetKey } from "./playRequestState";
import { playNextFmTrack } from "./queueNavigation";
import type { PlayerGet, PlayerSet, PlayerStore } from "./types";

/**
 * 播放失败自动下一首（设置项）；FM 模式连播不受此开关影响。
 * 设置还没读到时按「不自动切」处理：没有用户的明确选择，就不替用户切歌。
 */
function isPlaybackFailedAutoNextEnabled(): boolean {
  return useSettingsStore.getState().settings?.playbackFailedAutoNext === true;
}

export const syncEngineToStore = (set: PlayerSet, get: PlayerGet) => {
  registerListeningStatsSampler(() => {
    const engine = playerEngine.sampleCurrentTime();
    return { at: engine.currentTimeSampledAtMonotonic, position: engine.currentTime, playing: engine.status === "playing", rate: engine.playbackRate };
  });
  /** Previous engine status: detect mid-play error vs resolve failure */
  let previousEngineStatus: PlayerStore["status"] | "idle" = "idle";
  let autoSkipTimer: ReturnType<typeof setTimeout> | null = null;
  let listeningKey: string | null = null;

  playerEngine.subscribe((engineState) => {
    if (engineState.currentMusic?.isLocal) {
      const latest = getLocalPlaybackMusic(engineState.currentMusic);
      if (latest !== engineState.currentMusic) {
        playerEngine.updateCurrentMusic(latest);
        return;
      }
    }
    const { isMuted, volume: storeVolume } = get();
    const prevStatus = previousEngineStatus;
    previousEngineStatus = engineState.status;

    if (engineState.status === "loading" && listeningKey !== null) {
      finishListeningStats();
      listeningKey = null;
    }

    if (engineState.currentMusic && engineState.status !== "loading") {
      const key = buildPlayRequestKey(engineState.currentMusic);
      const sample = {
        at: engineState.currentTimeSampledAtMonotonic,
        position: engineState.currentTime,
        playing: engineState.status === "playing",
        rate: engineState.playbackRate,
      };
      if (engineState.status === "playing" && listeningKey !== key) {
        startListeningStats(engineState.currentMusic, sample);
        listeningKey = key;
      } else if (listeningKey === key) {
        if (prevStatus === "playing" && engineState.status !== "playing") pauseListeningStats(sample);
        sampleListeningStats(sample);
      }
      if (engineState.status === "error") {
        finishListeningStats();
        listeningKey = null;
      }
    }
    if (engineState.currentMusic == null && listeningKey !== null) {
      finishListeningStats();
      listeningKey = null;
    }

    const engineTargetKey = getEngineTargetKey();
    if (engineTargetKey != null) {
      const engineKey = engineState.currentMusic
        ? buildPlayRequestKey(engineState.currentMusic)
        : "";
      // 上一首的状态/进度推送：直接丢弃，不能覆盖本次请求写入的 loading / error
      if (engineKey !== engineTargetKey) return;
      // 引擎已真正接管目标曲目，恢复直通
      setEngineTargetKey(null);
    }

    // 引擎里没有加载任何音频时（启动后未播放、或 stop/clearQueue 之后），它推送的
    // currentMusic 是 null —— 那是「引擎还没参与」，不是「当前曲目被清空」。
    // 启动时恢复的会话（队列 / 当前曲 / 进度 / 时长）必须留住：恢复音量这一步就会触发
    // 一次引擎推送，旧代码用它覆盖 current/progress/duration，实测症状就是重启后进度全丢。
    // 真正的清空路径（stop / clearQueue / 换曲）都在 store 侧显式 set，不依赖这次同步。
    const engineHasTrack = engineState.currentMusic != null;
    set({
      status: engineState.status,
      volume: isMuted ? storeVolume : engineState.volume,
      error: engineState.error,
      ...(engineHasTrack ? {
        playbackRate: engineState.playbackRate,
        progress: engineState.currentTime,
        // 锚点用 engine 采样时刻（同帧），UI 外推不再重复计入 React 渲染延迟
        progressSampledAt: engineState.currentTimeSampledAt,
        duration: engineState.duration,
        current: engineState.currentMusic,
      } : {}),
    });

    // 普通队列：仅 playing→error 自动跳（loading→error 由 playAndDidFail 处理），由设置开关控制
    // FM 模式：始终自动跳，loading→error 也要跳，否则推荐死链会卡死
    // 仅在真正跨入 error 时记一次：error 停留期间引擎仍可能推状态，
    // 无条件记录会把同一次失败放大成每帧一条日志（每条还是一次 Tauri IPC）。
    if (engineState.status === "error" && prevStatus !== "error") {
      const currentName = get().current?.name ?? "?";
      const errMsg = engineState.error ? String(engineState.error) : "unknown";
      debugLog(`[engine] 播放错误 status=${prevStatus}->error 歌曲=${currentName} 错误=${errMsg} url=${(engineState.currentUrl ?? "").slice(0, 80)}`);
      // 解析成功但播放器拒收（典型：lx 代理返回的地址实际不可播），把该曲的
      // 持久化 URL 与预读缓存一并作废，否则坏链会被缓存 6h 反复命中「一播就错」。
      // 对齐移动端 Event.PlaybackError 的处置。
      const failed = get().current;
      if (failed) {
        void invalidateCachedPlaybackUrl(failed).catch(() => undefined);
        invalidatePrefetchedTrack(failed);
      }
    }
    const fmMode = get().fmMode;
    const shouldAutoSkip =
      engineState.status === "error" &&
      ((prevStatus === "playing" && (fmMode || isPlaybackFailedAutoNextEnabled())) ||
        (prevStatus === "loading" && fmMode));
    if (shouldAutoSkip) {
      if (autoSkipTimer) clearTimeout(autoSkipTimer);
      autoSkipTimer = setTimeout(() => {
        autoSkipTimer = null;
        const store = get();
        if (store.status !== "error") return;
        if (store.fmMode) {
          void playNextFmTrack(set, get);
          return;
        }
        store.next().catch(() => undefined);
      }, 250);
    }
  });

  playerEngine.onEnded(() => {
    finishListeningStats();
    listeningKey = null;
    const { repeatMode, queue, currentIndex, fmMode } = get();
    // 定时关闭（按时间）：曲结束时若定时器到期直接停，不进入下一首
    const sleep = useSleepTimerStore.getState();
    if (sleep.mode === "songs" && sleep.consumeCompletedSong()) {
      get().pause();
      return;
    }
    if (sleep.mode === "timer" && sleep.remainingSec <= 0) {
      useSleepTimerStore.setState({ mode: "off", remainingSec: 0 });
      get().pause();
      return;
    }
    // FM 模式：忽略 repeat / queue，永远拉下一首 FM 推荐
    if (fmMode) {
      void playNextFmTrack(set, get);
      return;
    }
    if (repeatMode === "one" && queue.length > 0) {
      get().play(queue[currentIndex]).catch(() => undefined);
    } else {
      get().next().catch(() => undefined);
    }
  });
};

/**
 * 试听兜底（与移动端一致）：解析期拿不到长度头的流式响应靠播放器实际时长判定。
 * 判定即停播并失效持久化 / 预读 / 磁盘三层缓存，下次重播强制重新解析（对齐失败即停哲学）。
 */
export function stopOnPreviewDetected(set: PlayerSet, get: PlayerGet): void {
  playerEngine.onPreviewDetected((duration) => {
    const current = get().current;
    if (!current) return;
    void invalidatePersistentPlaybackCache(current, current);
    invalidatePrefetchedTrack(current);
    void removeCachedAudioForMusic(current);
    playerEngine.pause();
    set({
      status: "error",
      error: `检测到试听片段（约 ${Math.round(duration)}s），已清除缓存，请重新播放或切换音源`,
    });
  });
}
