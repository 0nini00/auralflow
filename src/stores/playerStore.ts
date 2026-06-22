import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import { playerEngine } from "@/services/playerEngine";
import { resolvePlaybackUrl } from "@/services/playback/playbackResolver";
import { patchSettings } from "@lx/tauri-bridge";
import { useHistoryStore } from "./historyStore";
import { useSleepTimerStore } from "./sleepTimerStore";
import { useDiscoveryStore } from "./discoveryStore";

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
  setRepeatMode: (mode: RepeatMode) => void;
  toggleShuffle: () => void;
  enterFmMode: () => void;
  exitFmMode: () => void;
}

let volumePersistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleVolumePersist(volume: number) {
  if (volumePersistTimer) clearTimeout(volumePersistTimer);
  volumePersistTimer = setTimeout(() => {
    volumePersistTimer = null;
    patchSettings({ volume: Math.round(volume * 100) }).catch(() => {});
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

/** 计算队列中下一首将播放的曲目，预解析其 URL 交给引擎缓存。 */
async function preloadNext(get: any): Promise<void> {
  const { queue, currentIndex, repeatMode, isShuffle, fmMode } = get();
  if (fmMode || queue.length === 0) return;
  let nextIndex: number;
  if (isShuffle) {
    const candidates = queue.map((_: unknown, i: number) => i).filter((i: number) => i !== currentIndex);
    if (candidates.length === 0) return;
    nextIndex = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      if (repeatMode !== "all") return;
      nextIndex = 0;
    }
  }
  const nextMusic = queue[nextIndex];
  if (!nextMusic) return;
  try {
    if ('isLocal' in nextMusic && nextMusic.isLocal && nextMusic.url) {
      playerEngine.preload(nextMusic.url as string);
      return;
    }
    const variants = Array.isArray((nextMusic as any).variants) ? (nextMusic as any).variants as MusicInfo[] : undefined;
    const resolved = await resolvePlaybackUrl(nextMusic, variants);
    if (resolved?.url) playerEngine.preload(resolved.url);
  } catch {
    // 预加载失败不影响当前播放
  }
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
      get().play(queue[currentIndex]).catch(() => {});
    } else {
      get().next().catch(() => {});
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

    play: async (music) => {
      try {
        // 检查是否为本地音乐
        if ('isLocal' in music && music.isLocal && 'url' in music && music.url) {
          // 本地音乐直接使用已有的 URL
          await playerEngine.play(music, music.url as string);
          useHistoryStore.getState().add(music);
          preloadNext(get);
          return;
        }

        set({ status: "loading", error: null });
        // 在线音乐交给播放解析器：先内置网易云，失败后再走备用播放方式。
        const variants = Array.isArray((music as any).variants) ? (music as any).variants as MusicInfo[] : undefined;
        const resolved = await resolvePlaybackUrl(music, variants);
        if (!resolved?.url) {
          set({
            status: "error",
            error: "当前播放方式没有返回可播放地址",
          });
          return;
        }
        await playerEngine.play(resolved.music, resolved.url);
        useHistoryStore.getState().add(music);
        preloadNext(get);
      } catch (e) {
        console.error('[playerStore] play failed', e);
        set({
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },

    playQueue: async (queue, startIndex = 0) => {
      // 用户主动选了别的歌单/队列，自动退出 FM 模式
      set({ queue, currentIndex: startIndex, fmMode: false });
      const music = queue[startIndex];
      if (music) await get().play(music);
    },

    playByIndex: async (index) => {
      const { queue } = get();
      if (index < 0 || index >= queue.length) return;
      set({ currentIndex: index });
      await get().play(queue[index]);
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
          playerEngine.stop();
          newIndex = -1;
        }
        
        return { queue: newQueue, currentIndex: newIndex };
      });
    },

    clearQueue: () => {
      playerEngine.stop();
      set({
        queue: [],
        currentIndex: -1,
        current: null,
        status: "idle",
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
        play(current).catch(() => {});
      }
    },

    pause: () => {
      playerEngine.pause();
    },

    resume: () => {
      playerEngine.resume();
    },

    stop: () => {
      playerEngine.stop();
      set({
        current: null,
        queue: [],
        currentIndex: -1,
        status: "idle",
        progress: 0,
        duration: 0,
        error: null,
      });
    },

    next: async () => {
      const { queue, currentIndex, repeatMode, isShuffle, fmMode } = get();

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
      try {
        set({ currentIndex: nextIndex });
        await get().play(queue[nextIndex]);
      } catch {
        // play 内部已 set status:error，不额外更新 index
      }
    },

    prev: async () => {
      const { queue, currentIndex } = get();
      if (queue.length === 0) return;
      const prevIndex = Math.max(0, currentIndex - 1);
      if (prevIndex === currentIndex) return;
      try {
        set({ currentIndex: prevIndex });
        await get().play(queue[prevIndex]);
      } catch {
        // play 内部已 set status:error
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
      } else {
        playerEngine.setVolume(0);
        set({ isMuted: true });
      }
    },

    setPlaybackRate: (rate) => {
      playerEngine.setPlaybackRate(rate);
      set({ playbackRate: rate });
    },

    setRepeatMode: (mode) => set({ repeatMode: mode }),
    toggleShuffle: () => set((state) => ({ isShuffle: !state.isShuffle })),

    enterFmMode: () => {
      set({ fmMode: true, queue: [], currentIndex: -1 });
    },
    exitFmMode: () => {
      set({ fmMode: false });
    },
  };
});
