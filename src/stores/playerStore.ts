import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import { playerEngine } from "@/services/playerEngine";
import { resolvePlaybackUrl } from "@/services/playback/playbackResolver";
import { prefetchNearbyTracks, getPrefetchedTrack, invalidatePrefetchedTrack } from "@/services/playback/prefetchService";
import { selectCachedPlaybackTarget } from "@/services/playback/prefetchModel";
import { getPlayModeState, type PlayModeId } from "@/services/playback/playModeControl";
import { patchSettings } from "@lx/tauri-bridge";
import { useHistoryStore } from "./historyStore";
import { useSleepTimerStore } from "./sleepTimerStore";
import { useDiscoveryStore } from "./discoveryStore";
import { logAsyncError } from "@/utils/logAsyncError";

export type RepeatMode = "off" | "all" | "one";

interface PlayerStore {
  current: MusicInfo | null;
  queue: MusicInfo[];
  currentIndex: number;
  status: "idle" | "loading" | "playing" | "paused" | "error";
  progress: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  error: string | null;
  /** 私人 FM 模式：true 时播放结束/手动 next 走 discoveryStore.fmNext */

  fmMode: boolean;

  /** 随机模式下记录播放历史索引，用于 prev() 回退到真正上一首 */

  playHistory: number[];

  play: (music: MusicInfo) => Promise<void>;
  playQueue: (queue: MusicInfo[], startIndex?: number) => Promise<void>;
  playByIndex: (index: number) => Promise<void>;
  addToQueue: (music: MusicInfo) => void;
  playNext: (music: MusicInfo) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  togglePlay: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  setProgress: (progress: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  setPlayMode: (mode: PlayModeId) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  toggleShuffle: () => void;
  enterFmMode: () => void;
  exitFmMode: () => void;
}

let volumePersistTimer: ReturnType<typeof setTimeout> | null = null;
let activePlayRequestId = 0;
let inflightPlayRequest: { id: number; key: string; promise: Promise<void> } | null = null;

function buildPlayRequestKey(music: MusicInfo): string {
  const localUrl =
    'isLocal' in music && music.isLocal && 'url' in music && music.url
      ? String(music.url)
      : "";
  return `${music.source}:${music.id}:${localUrl}`;
}

function didPlayFailForTarget(state: Pick<PlayerStore, "current" | "status">, music: MusicInfo): boolean {
  return (
    state.status === "error" &&
    state.current != null &&
    buildPlayRequestKey(state.current) === buildPlayRequestKey(music)
  );
}

async function playAndDidFail(get: () => PlayerStore, music: MusicInfo): Promise<boolean> {
  await get().play(music);
  return didPlayFailForTarget(get(), music);
}

function invalidatePlayRequest() {
  activePlayRequestId += 1;
  inflightPlayRequest = null;
}

function scheduleVolumePersist(volume: number) {
  if (volumePersistTimer) clearTimeout(volumePersistTimer);
  volumePersistTimer = setTimeout(() => {
    volumePersistTimer = null;
    patchSettings({ volume: Math.round(volume * 100) }).catch(logAsyncError("player:persist-volume"));
  }, 400);
}

/** 调用 discoveryStore.fmNext 后播放下一首 FM 曲目；失败返回 false */
async function playNextFmTrack(get: any): Promise<boolean> {
  try {
    const next = await useDiscoveryStore.getState().fmNext();
    if (next) {
      await get().play(next);
      return true;
    }
  } catch (err) {
    console.warn("[player] fm auto-next failed", err);
  }
  return false;
}

/** 预热当前曲目附近的 URL、歌词和封面，切歌与看歌词时更快可用。 */
async function preloadNext(get: any): Promise<void> {
  const { queue, currentIndex, repeatMode, isShuffle, fmMode } = get();
  await prefetchNearbyTracks({ queue, currentIndex, repeatMode, isShuffle, fmMode });
}

const syncEngineToStore = (set: any, get: any) => {
  playerEngine.subscribe((engineState) => {
    set({
      status: engineState.status,
      progress: engineState.currentTime,
      duration: engineState.duration,
      volume: engineState.volume,
      playbackRate: engineState.playbackRate,
      current: engineState.currentMusic,
      error: engineState.error,
    });
  });

  playerEngine.onEnded(() => {
    const { repeatMode, queue, currentIndex, fmMode } = get();
    // 定时关闭（按时间）：曲结束时若定时器到期直接停，不进入下一首
    const sleep = useSleepTimerStore.getState();
    if (sleep.mode === "timer" && sleep.remainingSec <= 0) {
      useSleepTimerStore.setState({ mode: "off", remainingSec: 0 });
      get().pause();
      return;
    }
    // FM 模式：忽略 repeat / queue，永远拉下一首 FM 推荐
    if (fmMode) {
      void playNextFmTrack(get);
      return;
    }
    if (repeatMode === "one" && queue.length > 0) {
      get().play(queue[currentIndex]).catch(logAsyncError("player:auto-repeat-one"));
    } else {
      get().next().catch(logAsyncError("player:auto-next"));
    }
  });
};

export const usePlayerStore = create<PlayerStore>((set, get) => {
  syncEngineToStore(set, get);

  return {
    current: null,
    queue: [],
    currentIndex: -1,
    status: "idle",
    progress: 0,
    duration: 0,
    volume: 0.8,
    isMuted: false,
    playbackRate: 1.0,
    repeatMode: "all",
    isShuffle: false,
    error: null,

    fmMode: false,

    playHistory: [],



    play: async (music) => {
      const requestKey = buildPlayRequestKey(music);
      if (get().status === "loading" && inflightPlayRequest?.key === requestKey) {
        return inflightPlayRequest.promise;
      }

      const requestId = activePlayRequestId + 1;
      activePlayRequestId = requestId;
      set({ current: music, status: "loading", error: null, progress: 0, duration: 0 });

      const run = (async () => {
        try {
          // 检查是否为本地音乐
          if ('isLocal' in music && music.isLocal && 'url' in music && music.url) {
            // 本地音乐直接使用已有的 URL
            if (requestId !== activePlayRequestId) return;
            await playerEngine.play(music, music.url as string);
            if (requestId !== activePlayRequestId) return;
            useHistoryStore.getState().add(music);
            preloadNext(get);
            return;
          }

          // 优先使用预加载缓存，命中则跳过网络解析

          const variants = Array.isArray((music as any).variants) ? (music as any).variants as MusicInfo[] : undefined;
          const cachedTarget = selectCachedPlaybackTarget(music, getPrefetchedTrack(music));

          if (cachedTarget) {

            if (requestId !== activePlayRequestId) return;

            try {
              await playerEngine.play(cachedTarget.music, cachedTarget.url);
            } catch (cachedError) {
              invalidatePrefetchedTrack(music);
              if (cachedTarget.music.source !== music.source || cachedTarget.music.id !== music.id) {
                invalidatePrefetchedTrack(cachedTarget.music);
              }

              const resolved = await resolvePlaybackUrl(music, variants);
              if (requestId !== activePlayRequestId) return;

              if (!resolved?.url) {
                throw cachedError;
              }

              await playerEngine.play(resolved.music, resolved.url);
            }

          } else {

            // 在线音乐交给播放解析器：先内置网易云，失败后再走备用播放方式。

            const resolved = await resolvePlaybackUrl(music, variants);

            if (requestId !== activePlayRequestId) return;

            if (!resolved?.url) {

              set({

                status: "error",

                error: "当前播放方式没有返回可播放地址",

              });

              return;

            }

            await playerEngine.play(resolved.music, resolved.url);

          }
          if (requestId !== activePlayRequestId) return;
          useHistoryStore.getState().add(music);
          preloadNext(get);
        } catch (e) {
          if (requestId !== activePlayRequestId) return;
          console.error('[playerStore] play failed', e);
          set({
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        } finally {
          if (inflightPlayRequest?.id === requestId) {
            inflightPlayRequest = null;
          }
        }
      })();

      inflightPlayRequest = { id: requestId, key: requestKey, promise: run };
      return run;
    },

    playQueue: async (queue, startIndex = 0) => {

      // 用户主动选了别的歌单/队列，自动退出 FM 模式，清空播放历史

      set({ queue, currentIndex: startIndex, fmMode: false, playHistory: [] });
      const music = queue[startIndex];
      if (music) await get().play(music);
    },

    playByIndex: async (index) => {
      const { queue } = get();
      if (index < 0 || index >= queue.length) return;
      const previousIndex = get().currentIndex;
      set({ currentIndex: index });
      try {
        const failed = await playAndDidFail(get, queue[index]);
        if (failed) set({ currentIndex: previousIndex });
      } catch {
        set({ currentIndex: previousIndex });
      }
    },

    addToQueue: (music) => {
      set((state) => ({ queue: [...state.queue, music] }));
    },

    playNext: (music) => {
      set((state) => {
        if (state.queue.length === 0 || state.currentIndex < 0) {
          return { queue: [music], currentIndex: 0 };
        }
        const nextIndex = Math.min(state.currentIndex + 1, state.queue.length);
        const queue = [...state.queue];
        queue.splice(nextIndex, 0, music);
        return { queue };
      });
    },

    removeFromQueue: (index) => {
      set((state) => {
        const newQueue = state.queue.filter((_, i) => i !== index);
        let newIndex = state.currentIndex;
        
        // Adjust current index if needed
        if (index < state.currentIndex) {
          newIndex = state.currentIndex - 1;
        } else if (index === state.currentIndex) {
          // If we're removing the current track, stop playback
          invalidatePlayRequest();
          playerEngine.stop();
          newIndex = -1;
        }
        
        // 同步更新 playHistory：移除命中的条目，大于 index 的条目前移一位
        const newHistory = state.playHistory
          .filter((h) => h !== index)
          .map((h) => (h > index ? h - 1 : h));
        
        return { queue: newQueue, currentIndex: newIndex, playHistory: newHistory };
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
        play(current).catch(logAsyncError("player:toggle-play"));
      }
    },

    pause: () => {
      playerEngine.pause();
    },

    resume: () => {
      playerEngine.resume();
    },

    stop: () => {

      invalidatePlayRequest();

      playerEngine.stop();

      set({

        current: null,

        queue: [],

        currentIndex: -1,

        status: "idle",

        progress: 0,

        duration: 0,

        error: null,

        playHistory: [],

      });

    },

    next: async () => {

      const { queue, currentIndex, repeatMode, isShuffle, fmMode, playHistory } = get();



      // FM 模式：放弃 queue 逻辑，拉下一首推荐

      if (fmMode) {

        await playNextFmTrack(get);

        return;

      }



      if (queue.length === 0) {

        playerEngine.pauseAtEnd();

        return;

      }



      let nextIndex: number;



      if (isShuffle) {

        // Random mode: pick a random index (excluding current)

        const availableIndices = queue

          .map((_, i) => i)

          .filter((i) => i !== currentIndex);

        if (availableIndices.length === 0) {

          // Only one song in queue, play it again if repeat is on

          if (repeatMode === "all") {

            nextIndex = 0;

          } else {

            playerEngine.pauseAtEnd();

            return;

          }

        } else {

          nextIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];

        }

        // 随机模式下把当前索引压入历史，供 prev() 回退

        if (currentIndex >= 0) {

          set({ playHistory: [...playHistory, currentIndex] });

        }

      } else {

        // Sequential mode

        nextIndex = currentIndex + 1;

        if (nextIndex >= queue.length) {

          if (repeatMode === "all") {

            nextIndex = 0;

          } else {

            playerEngine.pauseAtEnd();

            return;

          }

        }

      }

      

      // 先更新 index，使 play() 内部的 preloadNext 能读到正确的下一首

      const prevIndex = currentIndex;
      const previousPlayHistory = playHistory;

      try {

        set({ currentIndex: nextIndex });

        const failed = await playAndDidFail(get, queue[nextIndex]);
        if (failed) {
          set({ currentIndex: prevIndex, playHistory: previousPlayHistory });
        }

      } catch {

        // play 失败时回滚 index，避免 UI 指向未成功播放的曲目

        set({ currentIndex: prevIndex, playHistory: previousPlayHistory });

      }

    },



    prev: async () => {

      const { queue, currentIndex, isShuffle, playHistory } = get();

      if (queue.length === 0) return;



      let prevIndex: number;



      if (isShuffle && playHistory.length > 0) {

        // 随机模式：从历史栈弹出上一首

        const history = [...playHistory];

        prevIndex = history.pop()!;

        set({ playHistory: history });

      } else {

        prevIndex = Math.max(0, currentIndex - 1);

      }



      if (prevIndex === currentIndex) return;

      const savedIndex = currentIndex;
      const savedPlayHistory = playHistory;

      try {

        set({ currentIndex: prevIndex });

        const failed = await playAndDidFail(get, queue[prevIndex]);
        if (failed) {
          set({ currentIndex: savedIndex, playHistory: savedPlayHistory });
        }

      } catch {

        set({ currentIndex: savedIndex, playHistory: savedPlayHistory });

      }

    },

    setProgress: (progress) => {
      playerEngine.seek(progress);
    },

    setVolume: (volume) => {
      const clamped = Math.max(0, Math.min(volume, 1));
      playerEngine.setVolume(clamped);
      set({ volume: clamped, isMuted: clamped === 0 });
      scheduleVolumePersist(clamped);
    },

    toggleMute: () => {

      const { isMuted, volume } = get();

      if (isMuted) {

        const restored = volume > 0 ? volume : 0.8;

        playerEngine.setVolume(restored);

        set({ isMuted: false, volume: restored });

        scheduleVolumePersist(restored);

      } else {

        playerEngine.setVolume(0);

        set({ isMuted: true });

        scheduleVolumePersist(0);

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

    enterFmMode: () => {

      set({ fmMode: true, queue: [], currentIndex: -1, playHistory: [] });

    },
    exitFmMode: () => {
      set({ fmMode: false });
    },
  };
});
