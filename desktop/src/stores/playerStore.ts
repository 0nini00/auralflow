/**
 * 主窗口的播放 store。对外只有 usePlayerStore（和 RepeatMode 类型）；实现按职责放在 player/ 下：
 * types（状态与动作类型）、playRequestState（请求代次与在途状态）、playbackPipeline（play 与取链）、
 * queueNavigation（上一首 / 下一首 / FM 续播）、engineSync（引擎事件同步）、queueActions（队列编辑）、
 * volumeActions（音量与静音）。这里负责组装，并留着播放控制、播放模式、FM 开关和一次性提示这些短动作。
 */
import { useLibraryStore } from "./libraryStore";
import { synchronizeLocalQueue } from "@/services/localPlaybackMetadata";
import { createLibraryStore } from "./libraryPersistence";
import { playerEngine } from "@/services/playerEngine";
import { getPlayModeState } from "@/services/playback/playModeControl";
import { finishListeningStats, pauseListeningStats, seekListeningStats, sampleListeningStats } from "./listeningStatsStore";
import { stopOnPreviewDetected, syncEngineToStore } from "./player/engineSync";
import { createPlay, getLocalPlaybackMusic } from "./player/playbackPipeline";
import { buildPlayRequestKey, invalidatePlayRequest, resetPlaybackHealth, resumePlaybackRecovery } from "./player/playRequestState";
import { createQueueActions } from "./player/queueActions";
import { createQueueNavigation } from "./player/queueNavigation";
import type { PlayerStore } from "./player/types";
import { createVolumeActions } from "./player/volumeActions";

export type { RepeatMode } from "./player/types";

/** 跨源降级注记停留时长：足够被看见，又不至于常驻压住播放条 */
const PLAYBACK_NOTICE_HOLD_MS = 10_000;
let playbackNoticeToken = 0;

export const usePlayerStore = createLibraryStore<PlayerStore>((set, get) => {
  syncEngineToStore(set, get);
  stopOnPreviewDetected(set, get);
  const queueNavigation = createQueueNavigation(set, get);
  const queueActions = createQueueActions(set, get);
  const volumeActions = createVolumeActions(set, get);

  return {
    current: null,
    queue: [],
    currentIndex: -1,
    status: "idle",
    progress: 0,
    progressSampledAt: Date.now(),
    duration: 0,
    volume: 0.8,
    isMuted: false,
    playbackRate: 1.0,
    repeatMode: "all",
    isShuffle: false,
    error: null,
    playbackNotice: null,

    fmMode: false,

    playHistory: [],
    fmHistory: [],
    pinnedNextSong: null,

    play: createPlay(set, get),

    playQueue: queueActions.playQueue,
    playByIndex: queueNavigation.playByIndex,
    addToQueue: queueActions.addToQueue,
    playNext: queueActions.playNext,
    removeFromQueue: queueActions.removeFromQueue,
    insertQueueAt: queueActions.insertQueueAt,
    clearQueue: queueActions.clearQueue,

    togglePlay: () => {
      const { status, current, play, resume, pause } = get();
      if (!current) return;
      if (status === "playing") {
        pause();
      } else if (status === "paused") {
        resume();
      } else {
        // idle / error / loading：重新解析播放（resume 无法从这些状态恢复）
        play(current).catch(() => undefined);
      }
    },

    pause: () => {
      const { status, current } = get();
      invalidatePlayRequest(true);
      playerEngine.pause();
      const engine = playerEngine.getState();
      pauseListeningStats({ at: engine.currentTimeSampledAtMonotonic, position: engine.currentTime, playing: false, rate: engine.playbackRate });
      if (status === "loading") {
        set({ status: "paused", current, progress: 0, duration: 0, progressSampledAt: Date.now(), error: null });
      }
    },

    resume: () => {
      const current = get().current;
      const loaded = playerEngine.getState().currentMusic;
      if (current && (!loaded || buildPlayRequestKey(current) !== buildPlayRequestKey(loaded))) {
        void get().play(current).catch(() => undefined);
        return;
      }
      if (current) resumePlaybackRecovery(buildPlayRequestKey(current));
      playerEngine.resume();
    },

    stop: () => {
      invalidatePlayRequest();
      playerEngine.stop();
      finishListeningStats();
      set({
        current: null,
        queue: [],
        currentIndex: -1,
        status: "idle",
        progress: 0,
        progressSampledAt: Date.now(),
        duration: 0,
        error: null,
        playHistory: [],
      });
    },

    next: queueNavigation.next,
    prev: queueNavigation.prev,

    setProgress: (progress) => {
      resetPlaybackHealth();
      const before = playerEngine.sampleCurrentTime();
      sampleListeningStats({ at: before.currentTimeSampledAtMonotonic, position: before.currentTime, playing: before.status === "playing", rate: before.playbackRate });
      // seek 同步推送进度；先重置测量基点，避免小幅跳转被误认成连续播放。
      seekListeningStats({ at: typeof performance !== "undefined" ? performance.now() : Date.now(), position: progress, playing: before.status === "playing", rate: before.playbackRate });
      playerEngine.seek(progress);
      const engine = playerEngine.getState();
      seekListeningStats({ at: engine.currentTimeSampledAtMonotonic, position: engine.currentTime, playing: engine.status === "playing", rate: engine.playbackRate });
    },

    setVolume: volumeActions.setVolume,
    toggleMute: volumeActions.toggleMute,

    setPlaybackRate: (rate) => {
      playerEngine.setPlaybackRate(rate);
      set({ playbackRate: rate });
    },

    setPlayMode: (mode) => {
      const next = getPlayModeState(mode);
      set((state) => ({
        repeatMode: next.repeatMode,
        isShuffle: next.isShuffle,
        playHistory: next.isShuffle ? state.playHistory : [],
      }));
    },

    setRepeatMode: (mode) => set({ repeatMode: mode }),
    toggleShuffle: () => set((state) => {
      // 关闭随机模式时清空播放历史，避免残留的随机索引在 prev() 中指向错误的歌
      if (state.isShuffle) return { isShuffle: false, playHistory: [] };
      return { isShuffle: true };
    }),

    enterFmMode: (options) => {
      // soft：当前已是 FM 曲目时只挂上模式，不打断播放
      if (options?.soft) {
        set({ fmMode: true });
        return;
      }
      // 硬进入：停掉非 FM 播放，清普通队列，准备吃推荐流
      invalidatePlayRequest();
      playerEngine.stop();
      set({
        fmMode: true,
        queue: [],
        currentIndex: -1,
        playHistory: [],
        fmHistory: [],
        current: null,
        status: "idle",
      });
    },
    exitFmMode: () => {
      set({ fmMode: false });
    },
    notifyPlaybackNotice: (text) => {
      const token = ++playbackNoticeToken;
      set({ playbackNotice: text });
      setTimeout(() => {
        if (playbackNoticeToken === token) set({ playbackNotice: null });
      }, PLAYBACK_NOTICE_HOLD_MS);
    },
  };
});

// 保存本机资料后立即更新播放条/歌词与既有队列；实际音频保持原位置。
useLibraryStore.subscribe((state, previous) => {
  if (state.localSongs === previous.localSongs) return;
  const player = usePlayerStore.getState();
  const current = player.current ? getLocalPlaybackMusic(player.current) : null;
  const queue = synchronizeLocalQueue(player.queue, getLocalPlaybackMusic);
  if (current === player.current && queue === player.queue) return;
  usePlayerStore.setState({ current, queue });
  if (current && current !== player.current) playerEngine.updateCurrentMusic(current);
});
