import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import TrackPlayer, {
  State,
  RepeatMode,
  Event,
  AppKilledPlaybackBehavior,
  Capability
} from "react-native-track-player";
import type { MusicInfo } from "@lx/core";
import { getNextSongSleepTimerState, getSongSleepTimerTrackKey, normalizeSongSleepTimerCount } from "@/services/songSleepTimerModel";
import { getNextMobilePlayMode, getTrackPlayerRepeatModeForPlayMode, type MobilePlayMode } from "@/services/mobilePlayModeModel";
import { clampPlaybackRate, DEFAULT_PLAYBACK_RATE } from "@/services/playerRateModel";
import { DEFAULT_VOLUME, getNextMuteState, getNextVolumeState } from "@/services/playerVolumeModel";
import { insertSongAtQueueEnd, insertSongToPlayNext } from "@/services/songQueueActions";
import { syncPlaybackParameters } from "@/services/androidPitchService";



// ── 播放竞态保护 ──

let playRequestId = 0;



// ── 淡入淡出 ──

const FADE_OUT_MS = 80;

const FADE_IN_MS = 120;



async function fadeVolume(target: number, durationMs: number): Promise<void> {

  const steps = Math.max(1, Math.round(durationMs / 16));

  const current = await TrackPlayer.getVolume();

  const delta = (target - current) / steps;

  for (let i = 1; i <= steps; i++) {

    await TrackPlayer.setVolume(Math.max(0, Math.min(1, current + delta * i)));

    await new Promise((r) => setTimeout(r, durationMs / steps));

  }

  await TrackPlayer.setVolume(Math.max(0, Math.min(1, target)));

}



// ── 音量持久化 ──

const VOLUME_STORAGE_KEY = "af-player-volume";

let volumePersistTimer: ReturnType<typeof setTimeout> | null = null;



function persistVolume(volume: number): void {

  if (volumePersistTimer) clearTimeout(volumePersistTimer);

  volumePersistTimer = setTimeout(() => {

    volumePersistTimer = null;

    AsyncStorage.setItem(VOLUME_STORAGE_KEY, String(Math.round(volume * 100))).catch(() => {});

  }, 400);

}



export async function loadPersistedVolume(): Promise<number | null> {

  try {

    const raw = await AsyncStorage.getItem(VOLUME_STORAGE_KEY);

    if (raw != null) {

      const parsed = parseInt(raw, 10);

      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) return parsed / 100;

    }

  } catch {}

  return null;

}



export type PlayMode = MobilePlayMode;
export type PlaybackContextType = "queue" | "personalFm";

export interface PersonalFmContext {
  type: "personalFm";
  buffer: MusicInfo[];
  currentBatch: MusicInfo[];
  currentBatchIndex: number;
  hasMore: boolean;
}

export type PlaybackContext =
  | { type: "queue" }
  | PersonalFmContext;

let isPlayerSetup = false;
let playerSetupPromise: Promise<void> | null = null;

/**
 * 惰性初始化 TrackPlayer，带并发守卫（复用同一次 Promise，避免并发调用重复 setup）。
 * 快照恢复会先把 currentSong 写回 store 让 PlayerBar 可点，但此时播放器尚未 setup；
 * 所有会触碰原生播放器的控制方法都必须先 await 本函数，避免在未初始化时调用原生而崩溃。
 */
async function ensurePlayerSetup(): Promise<void> {
  if (isPlayerSetup) return;
  if (!playerSetupPromise) {
    playerSetupPromise = (async () => {
      await TrackPlayer.setupPlayer();
      await TrackPlayer.updateOptions({
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
        },
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
        ],
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
        ],
        progressUpdateEventInterval: 1,
      });
      isPlayerSetup = true;
    })();
  }
  try {
    await playerSetupPromise;
  } catch (error) {
    // setup 失败：清空缓存的 Promise，允许下次重试
    playerSetupPromise = null;
    throw error;
  }
}

// 睡眠定时器：使用 setTimeout 逐分钟递减剩余分钟数
let sleepTimerId: ReturnType<typeof setTimeout> | null = null;

function clearSleepTimerTimeout() {
  if (sleepTimerId) {
    clearTimeout(sleepTimerId);
    sleepTimerId = null;
  }
}

function scheduleSleepTimerTick() {
  clearSleepTimerTimeout();
  sleepTimerId = setTimeout(() => {
    const { sleepTimerMinutes } = usePlayerStore.getState();
    if (sleepTimerMinutes == null) {
      return;
    }
    const next = sleepTimerMinutes - 1;
    if (next <= 0) {
      // 时间到：停止播放并清除定时器状态
      clearSleepTimerTimeout();
      usePlayerStore.setState({
        sleepTimerMinutes: null,
        sleepTimerActive: false,
      });
      usePlayerStore
        .getState()
        .pause()
        .catch((error) => {
          console.error("Sleep timer pause error:", error);
        });
      return;
    }
    usePlayerStore.setState({ sleepTimerMinutes: next });
    scheduleSleepTimerTick();
  }, 60_000);
}

export interface PlayerState {
  // 当前播放
  currentSong: MusicInfo | null;
  currentUrl: string | null;

  // 播放状态
  isPlaying: boolean;
  loading: boolean;
  error: string | null;
  playbackRate: number;
  volume: number;
  previousVolume: number;
  isMuted: boolean;

  // 播放进度
  position: number;
  duration: number;

  // 播放队列
  queue: MusicInfo[];
  currentIndex: number;
  shuffleHistory: number[];

  // 播放模式
  playMode: PlayMode;

  // 播放上下文
  playbackContext: PlaybackContext;

  // 歌词
  lyrics: Array<{ time: number; text: string; tr?: string }>;

  // 睡眠定时器
  sleepTimerMinutes: number | null;
  sleepTimerActive: boolean;
  sleepTimerSongCount: number;
  sleepTimerSongActive: boolean;
  sleepTimerLastTrackKey: string | null;
}

interface PlayerActions {
  // 播放控制
  play: (song: MusicInfo, url: string, headers?: Record<string, string>) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;

  // 睡眠定时器
  startSleepTimer: (minutes: number) => void;
  startSongSleepTimer: (songCount: number) => void;
  cancelSleepTimer: () => void;

  // 队列控制
  setQueue: (songs: MusicInfo[], startIndex?: number) => void;
  addToQueue: (song: MusicInfo) => void;
  playNextInQueue: (song: MusicInfo) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => Promise<void>;

  // 播放模式
  setPlayMode: (mode: PlayMode) => Promise<void>;
  togglePlayMode: () => Promise<void>;

  // FM 上下文
  setQueuePlaybackContext: () => void;
  setPersonalFmContext: (payload: {
    currentBatch: MusicInfo[];
    currentBatchIndex: number;
    buffer?: MusicInfo[];
    hasMore?: boolean;
  }) => void;
  setPersonalFmBatchIndex: (index: number) => void;
  appendPersonalFmBuffer: (songs: MusicInfo[], hasMore?: boolean) => void;
  shiftPersonalFmBuffer: () => MusicInfo | null;
  markCurrentPersonalFmSongSkipped: () => void;

  // 状态更新
  updateProgress: (position: number, duration: number) => void;
  setLyrics: (lyrics: Array<{ time: number; text: string; tr?: string }>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  syncPlayerState: (state: State) => void;
}

type PlayerStore = PlayerState & PlayerActions;

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  // 初始状态
  currentSong: null,
  currentUrl: null,
  isPlaying: false,
  loading: false,
  error: null,
  playbackRate: DEFAULT_PLAYBACK_RATE,
  volume: DEFAULT_VOLUME,
  previousVolume: DEFAULT_VOLUME,
  isMuted: false,
  position: 0,
  duration: 0,
  queue: [],
  currentIndex: -1,
  shuffleHistory: [],
  playMode: "list",
  playbackContext: { type: "queue" },
  lyrics: [],
  sleepTimerMinutes: null,
  sleepTimerActive: false,
  sleepTimerSongCount: 0,
  sleepTimerSongActive: false,
  sleepTimerLastTrackKey: null,

  // 播放控制

  play: async (song: MusicInfo, url: string, headers?: Record<string, string>) => {

    const requestId = ++playRequestId;

    try {

      set({ loading: true, error: null });



      // 确保播放器已初始化

      await ensurePlayerSetup();



      // 淡出当前播放（避免切歌爆音）

      try { await fadeVolume(0, FADE_OUT_MS); } catch {}



      // 竞态检查：已有更新的 play 请求，丢弃本次

      if (requestId !== playRequestId) return;



      await TrackPlayer.reset();

      await TrackPlayer.add({

        id: `${song.source}-${song.id}`,

        url,

        title: song.name,

        artist: song.singer || "未知艺术家",

        album: song.albumName || "未知专辑",

        artwork: song.picUrl || song.img || undefined,

        duration: song.interval,

        // B站等需要 Referer 的音源通过 headers 传递请求头

        headers: headers ?? undefined,

      });



      const { playbackRate, volume } = get();

      const nextPlaybackRate = clampPlaybackRate(playbackRate);

      await TrackPlayer.setRate(nextPlaybackRate);

      await TrackPlayer.setVolume(0);

      await TrackPlayer.play();



      if (requestId !== playRequestId) return;



      // 淡入到目标音量

      void fadeVolume(volume, FADE_IN_MS);

      const latest = get();
      const nextSongSleepTimer = getNextSongSleepTimerState({
        isActive: latest.sleepTimerSongActive,
        remainingSongs: latest.sleepTimerSongCount,
        lastTrackKey: latest.sleepTimerLastTrackKey,
      }, song);

      set({
        currentSong: song,
        currentUrl: url,
        isPlaying: true,
        loading: false,
        playbackRate: nextPlaybackRate,
        position: 0,
        duration: song.interval || 0,
        sleepTimerSongActive: nextSongSleepTimer.isActive,
        sleepTimerSongCount: nextSongSleepTimer.remainingSongs,
        sleepTimerLastTrackKey: nextSongSleepTimer.lastTrackKey,
      });

      if (nextSongSleepTimer.shouldPause) {
        await get().pause();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "播放失败";
      console.error("Play error:", error);
      set({
        loading: false,
        error: message,
      });
      throw error;
    }
  },

  pause: async () => {
    // 播放器未 setup（如快照恢复后尚未播放）时无原生可暂停，仅同步 UI 状态。
    if (!isPlayerSetup) {
      set({ isPlaying: false });
      return;
    }
    try {
      await TrackPlayer.pause();
    } catch (error) {
      console.error("Pause error:", error);
    }
    set({ isPlaying: false });
  },

  resume: async () => {
    // 未 setup 时没有已加载的 track，无法 resume；忽略以避免调用未初始化的原生播放器。
    if (!isPlayerSetup) return;
    try {
      await TrackPlayer.play();
      set({ isPlaying: true });
    } catch (error) {
      console.error("Resume error:", error);
    }
  },

  stop: async () => {
    if (!isPlayerSetup) {
      set({ isPlaying: false, position: 0 });
      return;
    }
    try {
      await TrackPlayer.stop();
    } catch (error) {
      console.error("Stop error:", error);
    }
    set({ isPlaying: false, position: 0 });
  },

  seekTo: async (position: number) => {
    // 拖动进度可能传入非有限值（见 ProgressBar），入原生前兜底。
    if (!Number.isFinite(position)) return;
    if (!isPlayerSetup) {
      set({ position });
      return;
    }
    try {
      await TrackPlayer.seekTo(position);
    } catch (error) {
      console.error("Seek error:", error);
    }
    set({ position });
  },

  setPlaybackRate: async (rate: number) => {
    const nextRate = clampPlaybackRate(rate);
    set({ playbackRate: nextRate });
    await syncPlaybackParameters();
  },

  setVolume: async (volume: number) => {

    const next = getNextVolumeState(get(), volume);

    // 未 setup 时仅记录音量，下次 play() 会通过 setVolume 应用。

    if (isPlayerSetup) {

      try {

        await TrackPlayer.setVolume(next.volume);

      } catch (error) {

        console.error("Set volume error:", error);

      }

    }

    set(next);

    persistVolume(next.volume);

  },



  toggleMute: async () => {

    const next = getNextMuteState(get());

    if (isPlayerSetup) {

      try {

        await TrackPlayer.setVolume(next.volume);

      } catch (error) {

        console.error("Toggle mute error:", error);

      }

    }

    set(next);

    persistVolume(next.volume);

  },

  // 睡眠定时器
  startSleepTimer: (minutes: number) => {
    clearSleepTimerTimeout();
    const m = Math.max(0, Math.floor(minutes));
    if (m <= 0) {
      set({ sleepTimerMinutes: null, sleepTimerActive: false });
      return;
    }
    set({
      sleepTimerMinutes: m,
      sleepTimerActive: true,
      sleepTimerSongCount: 0,
      sleepTimerSongActive: false,
      sleepTimerLastTrackKey: null,
    });
    scheduleSleepTimerTick();
  },

  startSongSleepTimer: (songCount: number) => {
    clearSleepTimerTimeout();
    const normalizedCount = normalizeSongSleepTimerCount(songCount);
    set({
      sleepTimerMinutes: null,
      sleepTimerActive: false,
      sleepTimerSongCount: normalizedCount,
      sleepTimerSongActive: true,
      sleepTimerLastTrackKey: getSongSleepTimerTrackKey(get().currentSong),
    });
  },

  cancelSleepTimer: () => {
    clearSleepTimerTimeout();
    set({
      sleepTimerMinutes: null,
      sleepTimerActive: false,
      sleepTimerSongCount: 0,
      sleepTimerSongActive: false,
      sleepTimerLastTrackKey: null,
    });
  },

  // 队列控制
  setQueue: (songs: MusicInfo[], startIndex = 0) => {
    set({
      queue: songs,
      currentIndex: startIndex,
      shuffleHistory: [],
      playbackContext: { type: "queue" },
    });
  },

  addToQueue: (song: MusicInfo) => {
    set((state) => ({
      ...insertSongAtQueueEnd({ queue: state.queue, currentIndex: state.currentIndex, song }),
      playbackContext: { type: "queue" },
    }));
  },

  playNextInQueue: (song: MusicInfo) => {
    set((state) => ({
      ...insertSongToPlayNext({ queue: state.queue, currentIndex: state.currentIndex, song }),
      playbackContext: { type: "queue" },
    }));
  },

  removeFromQueue: (index: number) => {
    set((state) => {
      const newQueue = state.queue.filter((_, i) => i !== index);
      let newIndex = state.currentIndex;
      if (index < state.currentIndex) {
        newIndex--;
      } else if (index === state.currentIndex) {
        newIndex = Math.min(newIndex, newQueue.length - 1);
      }
      const nextShuffleHistory = state.shuffleHistory
        .filter((historyIndex) => historyIndex !== index)
        .map((historyIndex) => (historyIndex > index ? historyIndex - 1 : historyIndex));
      return {
        queue: newQueue,
        currentIndex: newIndex,
        shuffleHistory: nextShuffleHistory,
      };
    });
  },

  clearQueue: async () => {
    // stop 可能在播放器未 setup 时被调用（如快照恢复后直接清空队列），兜住 rejection 避免崩溃。
    try {
      await TrackPlayer.stop();
    } catch (error) {
      console.error("Clear queue stop error:", error);
    }
    set({
      currentSong: null,
      currentUrl: null,
      isPlaying: false,
      loading: false,
      error: null,
      position: 0,
      queue: [],
      currentIndex: -1,
      shuffleHistory: [],
      playbackContext: { type: "queue" },
    });
  },

  // FM 上下文
  setQueuePlaybackContext: () => {
    set({ playbackContext: { type: "queue" } });
  },

  setPersonalFmContext: ({ currentBatch, currentBatchIndex, buffer = [], hasMore = true }) => {
    set({
      playbackContext: {
        type: "personalFm",
        currentBatch,
        currentBatchIndex,
        buffer,
        hasMore,
      },
      queue: currentBatch,
      currentIndex: currentBatchIndex,
      shuffleHistory: [],
    });
  },

  setPersonalFmBatchIndex: (index: number) => {
    set((state) => {
      if (state.playbackContext.type !== "personalFm") {
        return state;
      }

      const maxIndex = Math.max(0, state.playbackContext.currentBatch.length - 1);
      const nextIndex = Math.max(0, Math.min(index, maxIndex));
      return {
        playbackContext: {
          ...state.playbackContext,
          currentBatchIndex: nextIndex,
        },
        currentIndex: nextIndex,
      };
    });
  },

  appendPersonalFmBuffer: (songs: MusicInfo[], hasMore = true) => {
    set((state) => {
      if (state.playbackContext.type !== "personalFm") {
        return state;
      }

      return {
        playbackContext: {
          ...state.playbackContext,
          buffer: [...state.playbackContext.buffer, ...songs],
          hasMore,
        },
      };
    });
  },

  shiftPersonalFmBuffer: () => {
    const state = get();
    if (state.playbackContext.type !== "personalFm") {
      return null;
    }

    const [nextSong, ...rest] = state.playbackContext.buffer;
    if (!nextSong) {
      return null;
    }

    set({
      playbackContext: {
        ...state.playbackContext,
        buffer: rest,
      },
    });

    return nextSong;
  },

  markCurrentPersonalFmSongSkipped: () => {
    const state = get();
    const context = state.playbackContext;
    if (context.type !== "personalFm") {
      return;
    }

    const nextBatch = context.currentBatch.filter((_, index) => index !== context.currentBatchIndex);
    const nextIndex = Math.max(0, Math.min(context.currentBatchIndex, nextBatch.length - 1));

    set({
      playbackContext: {
        ...context,
        currentBatch: nextBatch,
        currentBatchIndex: nextIndex,
      },
      queue: nextBatch,
      currentIndex: nextIndex,
    });
  },

  // 播放模式
  setPlayMode: async (mode: PlayMode) => {
    set({ playMode: mode });

    // 同步到 TrackPlayer；未 setup（如快照恢复后未播放）或原生异常时兜底，仅保留 UI 状态。
    const repeatMode = getTrackPlayerRepeatModeForPlayMode(mode);
    try {
      if (repeatMode === "track") {
        await TrackPlayer.setRepeatMode(RepeatMode.Track);
      } else if (repeatMode === "off") {
        await TrackPlayer.setRepeatMode(RepeatMode.Off);
      } else {
        await TrackPlayer.setRepeatMode(RepeatMode.Queue);
      }
    } catch (error) {
      console.error("Set play mode error:", error);
    }
  },

  togglePlayMode: async () => {
    const { playMode } = get();
    await get().setPlayMode(getNextMobilePlayMode(playMode));
  },

  // 状态更新
  updateProgress: (position: number, duration: number) => {
    set({ position, duration });
  },

  setLyrics: (lyrics: Array<{ time: number; text: string; tr?: string }>) => {
    set({ lyrics });
  },

  setLoading: (loading: boolean) => {
    set({ loading });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  syncPlayerState: (state: State) => {
    const isPlaying =
      state === State.Playing || state === State.Buffering;
    set({ isPlaying });
  },
}));

// 监听播放器事件
export function setupPlayerListeners() {

  const updateProgress = usePlayerStore.getState().updateProgress;

  const syncPlayerState = usePlayerStore.getState().syncPlayerState;

  const setError = usePlayerStore.getState().setError;



  // 恢复上次保存的音量

  loadPersistedVolume().then((saved) => {

    if (saved != null) {

      usePlayerStore.setState({ volume: saved });

    }

  }).catch(() => {});

  // 播放进度更新
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
    updateProgress(position, duration);
  });

  // 播放状态变化
  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    syncPlayerState(state);
  });

  // 播放错误
  TrackPlayer.addEventListener(Event.PlaybackError, ({ message }) => {
    setError(message);
  });

  // 歌曲播放完毕，自动切换下一首
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
    console.log("Queue ended, playing next...");
    const { playMode, queue, playbackContext } = usePlayerStore.getState();

    if (playbackContext.type !== "personalFm" && playMode === "single") {
      await TrackPlayer.seekTo(0);
      await TrackPlayer.play();
      return;
    }

    if (queue.length > 0 || playbackContext.type === "personalFm") {
      const { playNext } = await import("../services/playerService");
      await playNext();
    }
  });
}





