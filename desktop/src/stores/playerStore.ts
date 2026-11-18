import { useLibraryStore } from "./libraryStore";
import { synchronizeLocalQueue } from "@/services/localPlaybackMetadata";
import { createLibraryStore } from "./libraryPersistence";
import type { MusicInfo } from "@lx/core";
import { playerEngine } from "@/services/playerEngine";
import { prefetchTracks } from "@/services/playback/prefetchService";
import { getPlayModeState } from "@/services/playback/playModeControl";
import { updateSettings } from "@/stores/settingsStore";
import { logger } from "@/services/logger";
import { finishListeningStats, pauseListeningStats, seekListeningStats, sampleListeningStats } from "./listeningStatsStore";
import { stopOnPreviewDetected, syncEngineToStore } from "./player/engineSync";
import { createPlay, getLocalPlaybackMusic } from "./player/playbackPipeline";
import { buildPlayRequestKey, invalidatePlayRequest } from "./player/playRequestState";
import { createQueueNavigation } from "./player/queueNavigation";
import type { PlayerStore } from "./player/types";

export type { RepeatMode } from "./player/types";

let volumePersistTimer: ReturnType<typeof setTimeout> | null = null;
/** 跨源降级注记停留时长：足够被看见，又不至于常驻压住播放条 */
const PLAYBACK_NOTICE_HOLD_MS = 10_000;
let playbackNoticeToken = 0;

function scheduleVolumePersist(volume: number) {
  if (volumePersistTimer) clearTimeout(volumePersistTimer);
  volumePersistTimer = setTimeout(() => {
    volumePersistTimer = null;
    updateSettings({ volume: Math.round(volume * 100) }).catch((error) => {
      logger.warn("保存音量失败，下次启动会回到上次保存的音量", error);
    });
  }, 400);
}

export const usePlayerStore = createLibraryStore<PlayerStore>((set, get) => {
  syncEngineToStore(set, get);
  stopOnPreviewDetected(set, get);
  const queueNavigation = createQueueNavigation(set, get);

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

    playQueue: async (queue, startIndex = 0) => {

      // 用户主动选了别的歌单/队列，自动退出 FM 模式，清空播放历史

      set({ queue, currentIndex: startIndex, fmMode: false, playHistory: [], pinnedNextSong: null });
      const music = queue[startIndex];
      if (music) await get().play(music);
    },

    playByIndex: queueNavigation.playByIndex,

    addToQueue: (music) => {
      set((state) => ({ queue: [...state.queue, music] }));
    },

    playNext: (music) => {

      const { queue, currentIndex } = get();

      // 空队列 / 无当前曲：插入后立即开播，避免只改 index 不出声

      if (queue.length === 0 || currentIndex < 0) {

        set({ queue: [music], currentIndex: 0, playHistory: [] });

        void get().play(music).catch(() => undefined);

        return;

      }



      set((state) => {

        const nextIndex = Math.min(state.currentIndex + 1, state.queue.length);

        const nextQueue = [...state.queue];

        nextQueue.splice(nextIndex, 0, music);

        // 与 removeFromQueue 对称：插入点及之后的 history 下标整体 +1

        const playHistory = state.playHistory.map((h) => (h >= nextIndex ? h + 1 : h));

        // 同时记下锚点：随机播放与 FM 模式下 next() 不会走到插入位置，需要它兜底

        return { queue: nextQueue, playHistory, pinnedNextSong: music };

      });

      // 立即预取该曲播放 URL/歌词/封面：播到它时命中预取缓存秒开（对齐移动端）。
      void prefetchTracks([music]).catch(() => undefined);

    },

    removeFromQueue: (index) => {
      let resumeTrack: MusicInfo | null = null;

      set((state) => {
        const newQueue = state.queue.filter((_, i) => i !== index);
        let newIndex = state.currentIndex;

        // Keep playHistory in sync: drop hit index, shift larger indices down
        const newHistory = state.playHistory
          .filter((h) => h !== index)
          .map((h) => (h > index ? h - 1 : h));

        if (index < state.currentIndex) {
          newIndex = state.currentIndex - 1;
          return { queue: newQueue, currentIndex: newIndex, playHistory: newHistory };
        }

        if (index === state.currentIndex) {
          // Removing current track: resume next (same index after delete), else previous; stop if empty
          if (newQueue.length === 0) {
            invalidatePlayRequest();
            playerEngine.stop();
            return {
              queue: [],
              currentIndex: -1,
              playHistory: [],
              current: null,
              status: "idle" as const,
            };
          }
          newIndex = index < newQueue.length ? index : newQueue.length - 1;
          resumeTrack = newQueue[newIndex] ?? null;
          return { queue: newQueue, currentIndex: newIndex, playHistory: newHistory };
        }

        return { queue: newQueue, currentIndex: newIndex, playHistory: newHistory };
      });

      if (resumeTrack) {
        void get().play(resumeTrack).catch(() => undefined);
      }
    },

    insertQueueAt: (index, music) => {
      set((state) => {
        const at = Math.max(0, Math.min(index, state.queue.length));
        const queue = [...state.queue];
        queue.splice(at, 0, music);
        const shift = (value: number) => (value >= at ? value + 1 : value);
        return {
          queue,
          currentIndex: at <= state.currentIndex ? state.currentIndex + 1 : state.currentIndex,
          playHistory: state.playHistory.map(shift),
        };
      });
    },

    clearQueue: () => {

      invalidatePlayRequest();

      playerEngine.stop();

      set({

        queue: [],

        currentIndex: -1,

        current: null,

        status: "idle",

        playHistory: [],
        pinnedNextSong: null,

      });

    },

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
      invalidatePlayRequest();
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
      const before = playerEngine.sampleCurrentTime();
      sampleListeningStats({ at: before.currentTimeSampledAtMonotonic, position: before.currentTime, playing: before.status === "playing", rate: before.playbackRate });
      // seek 同步推送进度；先重置测量基点，避免小幅跳转被误认成连续播放。
      seekListeningStats({ at: typeof performance !== "undefined" ? performance.now() : Date.now(), position: progress, playing: before.status === "playing", rate: before.playbackRate });
      playerEngine.seek(progress);
      const engine = playerEngine.getState();
      seekListeningStats({ at: engine.currentTimeSampledAtMonotonic, position: engine.currentTime, playing: engine.status === "playing", rate: engine.playbackRate });
    },

    setVolume: (volume) => {

      const clamped = Math.max(0, Math.min(volume, 1));

      playerEngine.setVolume(clamped);

      // 滑到 0 视为静音；非 0 则解除静音并写入逻辑音量

      set({ volume: clamped, isMuted: clamped === 0 });

      scheduleVolumePersist(clamped);

    },



    toggleMute: () => {

      const { isMuted, volume } = get();



      if (isMuted) {

        // store.volume 在静音期间保持为静音前的逻辑音量

        const restored = volume > 0 ? volume : 0.8;

        playerEngine.setVolume(restored);

        set({ isMuted: false, volume: restored });

        scheduleVolumePersist(restored);

      } else {

        // 只把 engine 静音；不把 store.volume 改成 0，也不 persist 0

        // 否则 unmute 只能回到默认 0.8，且下次启动音量被写成 0

        // 引擎会同步推送音量；先标记静音，订阅者才会保留逻辑音量。
        set({ isMuted: true });

        playerEngine.setVolume(0);

      }

    },

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
