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
import { getNextMobilePlayMode, type MobilePlayMode } from "@/services/mobilePlayModeModel";
import { clampPlaybackRate, DEFAULT_PLAYBACK_RATE } from "@/services/playerRateModel";
import { DEFAULT_VOLUME, getNextMuteState, getNextVolumeState } from "@/services/playerVolumeModel";
import {
  insertSongAtQueueEnd,
  insertSongToPlayNext,
  enqueueTempPlayList,
  removeFromTempPlayList as removeFromTempPlayListPure,
} from "@/services/songQueueActions";
import { syncPlaybackParameters } from "@/services/androidPitchService";



// ── 播放竞态保护 ──

let playRequestId = 0;

// ── 播放失败自动跳歌 ──

const PLAYBACK_ERROR_SKIP_LIMIT = 3;

const PLAYBACK_ERROR_SKIP_DELAY_MS = 1200;

let consecutivePlaybackErrors = 0;

let playbackErrorSkipTimer: ReturnType<typeof setTimeout> | null = null;



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
      // 把缓冲交给原生（ExoPlayer / AVPlayer），不做桌面端 WebAudio 的精细控制
      // 参考 lx-mobile 的理念：移动端让原生播放器自行管理缓冲/节流，只做必要调优。
      // 注意：音频焦点中断（handleAudioFocus）由 RemoteDuck 事件 + audioInterruptionPolicy
      // 自定义处理，故不启用 autoHandleInterruptions，避免双重处理。
      // maxCacheSize：启用 ExoPlayer SimpleCache 边播边缓存（与 lx-mobile 同机制），
      // 播放过的歌曲片段落盘，再次播放同一 URL 时离线即开、省流量。默认 1GB，与 lx 默认一致。
      await TrackPlayer.setupPlayer({
        minBuffer: 15,
        maxBuffer: 50,
        backBuffer: 10,
        playBuffer: 2.5,
        maxCacheSize: 1024 * 1024 * 1024,
      });
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
        // 进度事件间隔 0.25s：歌词行高亮/迷你进度在 250ms 内跟随行边界切换（对齐 lx 的
        // 精确行触发体验）。4 次/秒的状态更新对现代设备负担可忽略，且 position 订阅方
        // 均做了隔离/节流（PlayerBar 迷你歌词为叶子组件、悬浮窗更新有 250ms 节流）。
        progressUpdateEventInterval: 0.25,
      });
      // 原生重复模式固定 Off（见 setPlayMode 注释），保证每次启动的初始原生状态确定
      await TrackPlayer.setRepeatMode(RepeatMode.Off);
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
      usePlayerStore.getState().pause().catch(() => undefined);
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
  /** 随机模式本轮已播放过的索引，用于整轮去重（避免短期内重复随机到同一首） */
  playedIndices: number[];
  /** 稍后播放暂存区：独立于主队列，playNext 时优先消费，插播完自动回归主队列 */
  tempPlayList: MusicInfo[];

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
  play: (song: MusicInfo, url: string, headers?: Record<string, string>, startPosition?: number) => Promise<void>;
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

  // 稍后播放（独立暂存区）
  addToTempPlayList: (song: MusicInfo) => void;
  removeFromTempPlayListAt: (index: number) => void;
  clearTempPlayList: () => void;

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
  buffered: number;
  updateProgress: (position: number, duration: number, buffered?: number) => void;
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
  buffered: 0 as number,
  queue: [],
  currentIndex: -1,
  shuffleHistory: [],
  playedIndices: [],
  tempPlayList: [],
  playMode: "list",
  playbackContext: { type: "queue" },
  lyrics: [],
  sleepTimerMinutes: null,
  sleepTimerActive: false,
  sleepTimerSongCount: 0,
  sleepTimerSongActive: false,
  sleepTimerLastTrackKey: null,

  // 播放控制

  play: async (song: MusicInfo, url: string, headers?: Record<string, string>, startPosition?: number) => {

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



      // 竞态检查：add 之后再次确认请求仍有效，避免在已过期的请求上继续 setRate/setVolume/play

      if (requestId !== playRequestId) return;



      const { playbackRate, volume } = get();

      const nextPlaybackRate = clampPlaybackRate(playbackRate);      await TrackPlayer.setRate(nextPlaybackRate);
      await TrackPlayer.setVolume(0);
      await TrackPlayer.play();

      if (requestId !== playRequestId) return;

      // 快照恢复续播：跳转到上次保存的进度（仅首次播放恢复的歌曲时传入）
      if (startPosition && startPosition > 0) {
        try {
          await TrackPlayer.seekTo(startPosition);
        } catch {}
      }

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
        position: startPosition && startPosition > 0 ? startPosition : 0,
        duration: song.interval || 0,
        sleepTimerSongActive: nextSongSleepTimer.isActive,
        sleepTimerSongCount: nextSongSleepTimer.remainingSongs,
        sleepTimerLastTrackKey: nextSongSleepTimer.lastTrackKey,
      });

      if (nextSongSleepTimer.shouldPause) {
        await get().pause();
      }

      // 播放成功：清零连续错误计数（播放失败自动跳歌的上限依据）
      consecutivePlaybackErrors = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "播放失败";
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
    } catch {}
    set({ isPlaying: false });
  },

  resume: async () => {
    // 未 setup 时没有已加载的 track，无法 resume；忽略以避免调用未初始化的原生播放器。
    if (!isPlayerSetup) return;
    try {
      await TrackPlayer.play();
      set({ isPlaying: true });
    } catch {}
  },

  stop: async () => {
    if (!isPlayerSetup) {
      set({ isPlaying: false, position: 0 });
      return;
    }
    try {
      await TrackPlayer.stop();
    } catch {}
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
    } catch {}
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

      } catch {}

    }

    set(next);

    persistVolume(next.volume);

  },



  toggleMute: async () => {

    const next = getNextMuteState(get());

    if (isPlayerSetup) {

      try {

        await TrackPlayer.setVolume(next.volume);

      } catch {}

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
      playedIndices: [],
      // 切歌单时清空「稍后播放」暂存区（对齐 lx playList → clearTempPlayeList），
      // 避免上一歌单的插播曲目在新歌单里突然出现
      tempPlayList: [],
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
    // 「稍后播放」= 加入独立的 tempPlayList 暂存区，不污染主队列顺序。
    // playNext 会优先消费暂存区首曲（见 playerService.playNext）。
    set((state) => ({
      tempPlayList: enqueueTempPlayList({ tempPlayList: state.tempPlayList, song }),
    }));
  },

  addToTempPlayList: (song: MusicInfo) => {
    set((state) => ({
      tempPlayList: enqueueTempPlayList({ tempPlayList: state.tempPlayList, song }),
    }));
  },

  removeFromTempPlayListAt: (index: number) => {

    set((state) => ({

      tempPlayList: removeFromTempPlayListPure(state.tempPlayList, index),

    }));

  },

  clearTempPlayList: () => {
    set({ tempPlayList: [] });
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
      const nextPlayedIndices = state.playedIndices
        .filter((playedIndex) => playedIndex !== index)
        .map((playedIndex) => (playedIndex > index ? playedIndex - 1 : playedIndex));
      return {
        queue: newQueue,
        currentIndex: newIndex,
        shuffleHistory: nextShuffleHistory,
        playedIndices: nextPlayedIndices,
      };
    });
  },

  clearQueue: async () => {
    // stop 可能在播放器未 setup 时被调用（如快照恢复后直接清空队列），兜住 rejection 避免崩溃。
    try {
      await TrackPlayer.stop();
    } catch {}
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
      playedIndices: [],
      tempPlayList: [],
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
      playedIndices: [],
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
    // 切换播放模式（尤其进/出 shuffle）视为开新一轮，清空本轮去重记录。
    set({ playMode: mode, playedIndices: [] });

    // 原生 RepeatMode 固定为 Off：列表循环/单曲循环/随机/顺序全部由 JS 驱动
    // （PlaybackQueueEnded → playNext / 单曲重置），避免原生自动循环/切歌造成
    // currentIndex、歌词、进度等 JS 状态不同步（对齐 lx-mobile：原生只播单曲，
    // 切歌一律由 JS 调度）。未 setup（如快照恢复后未播放）或原生异常时兜底，仅保留 UI 状态。
    try {
      await TrackPlayer.setRepeatMode(RepeatMode.Off);
    } catch {}
  },

  togglePlayMode: async () => {
    const { playMode } = get();
    await get().setPlayMode(getNextMobilePlayMode(playMode));
  },

  // 状态更新
  updateProgress: (position: number, duration: number, buffered?: number) => {
    set({ position, duration, buffered: buffered ?? get().buffered });
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
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration, buffered }) => {
    updateProgress(position, duration, buffered);
  });

  // 播放状态变化
  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    syncPlayerState(state);
  });

  // 播放错误：展示错误后短暂延迟自动跳下一首（对齐 lx 播放失败跳过机制）。
  // 连续失败超过阈值则停止自动跳，避免坏歌单无限循环；用户手动切歌/播放成功会清零计数。
  TrackPlayer.addEventListener(Event.PlaybackError, ({ message }) => {
    if (!usePlayerStore.getState().currentSong) return;
    setError(message);
    consecutivePlaybackErrors += 1;
    if (consecutivePlaybackErrors > PLAYBACK_ERROR_SKIP_LIMIT) return;
    if (playbackErrorSkipTimer) clearTimeout(playbackErrorSkipTimer);
    playbackErrorSkipTimer = setTimeout(() => {
      playbackErrorSkipTimer = null;
      void (async () => {
        const state = usePlayerStore.getState();
        // 期间用户已手动恢复播放或正在加载新曲，则不再自动跳
        if (state.isPlaying || state.loading) return;
        const { playNext } = await import("../services/playerService");
        await playNext();
      })();
    }, PLAYBACK_ERROR_SKIP_DELAY_MS);
  });

  // 歌曲播放完毕，自动切换下一首
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
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





