import { create } from "zustand";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import TrackPlayer, {
  State,
  RepeatMode,
  Event,
  AppKilledPlaybackBehavior,
  Capability
} from "react-native-track-player";
import type { MusicInfo } from "@lx/core";
import { isPreviewDuration } from "@lx/core";
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
import { buildMobilePlayRequestKey } from "@/services/playerRequestModel";
import { invalidateCachedPlaybackUrl } from "@/services/playbackUrlCache";
import { invalidatePrefetchForSong } from "../services/playerService";



// ── 播放竞态保护 ──

let playRequestId = 0;

// 已判定为试听片段的歌曲 key：进度事件 0.25s 触发一次，防同一首歌重复告警。
const previewRejectedKeys = new Set<string>();

// 同 key 播放进入去重（对齐桌面端 inflightPlayRequest）：同 key 的并发 play 复用同一 Promise，
// 避免重复 reset/add 同一 track；不同 key 不去重，仍靠上面的令牌丢弃过期请求。
// key 含音质：同一首歌切换音质后再切，需发起全新 play 而不是复用旧音质的在途请求。
const inflightPlayRequests = new Map<string, Promise<void>>();





// ── 淡入淡出 ──

const FADE_OUT_MS = 80;

const FADE_IN_MS = 120;

/**
 * 曲末静音占位轨。
 *
 * 每首歌入队时跟一条 2 秒静音，使曲末不会因队列见底而停止播放——播放不停，
 * 前台服务就不会被回收，JS 线程有机会在这 2 秒内醒来解析并切下一首。
 * 检测到当前活动轨是它，就等同于「上一首播完了」。
 *
 * 包名固定于 android/app/build.gradle 的 applicationId；若修改需同步此处。
 * 音频文件：android/app/src/main/res/raw/silence_2s.wav
 */
export const SILENCE_GAP_TRACK_ID = "__auralflow_silence_gap__";
const SILENCE_GAP_TRACK_URL = "android.resource://cn.chenle.auralflow.mobile/raw/silence_2s";



async function fadeVolume(target: number, durationMs: number): Promise<void> {

  // App 在后台/锁屏时 RN 的 setTimeout 被系统严重节流甚至冻结，步进淡入淡出会卡住：
  // 淡出 await 不 resolve → reset/add/play 永远等不到（后台曲终不跳下一首的根因）；
  // 淡入 void 不阻塞但音量停在 0 → 静音播放。后台时直接一步设目标音量，跳过步进。
  if (AppState.currentState !== "active") {
    try { await TrackPlayer.setVolume(Math.max(0, Math.min(1, target))); } catch {}
    return;
  }

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
    const { sleepTimerMinutes, isPlaying } = usePlayerStore.getState();
    if (sleepTimerMinutes == null) {
      return;
    }
    // 暂停期间不倒数（对齐主流睡眠定时语义：只统计实际播放时长，
    // 否则「设 30 分钟听 5 分钟后暂停离开」回来很快就会被停）
    if (!isPlaying) {
      scheduleSleepTimerTick();
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
  /**
   * 外部音频临时压低（duck）时被压到的音量，null 表示未处于 duck 态。
   * duck 只改原生音量不动 store.volume；切歌淡入时以它为上限，
   * 避免导航播报等外部音频期间自动切歌把音量淡回满格。
   */
  externalDuckVolume: number | null;

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
  /**
   * 原生活动轨是否为曲末 2s 静音占位轨。
   * 间隙期间进度/时长事件属于占位轨：写入会污染真实进度（进度条跳成 2s），
   * seek 也会被按占位轨时长理解（表现"点了没反应"），消费方据此忽略/映射。
   */
  onSilenceGap: boolean;
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
  externalDuckVolume: null,
  position: 0,
  duration: 0,
  buffered: 0 as number,
  onSilenceGap: false,
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
    // 同 key 并发 play 去重：直接复用进行中的同一请求；完成后清除。不同 key 走下方令牌竞态丢弃。
    const requestKey = buildMobilePlayRequestKey(song);
    const inflight = inflightPlayRequests.get(requestKey);
    if (inflight) return inflight;

    // 新请求启动时清掉其它 key 的在途条目：单曲槽语义下它们必是被抢占的过期请求，
    // 留着会让稍后的重试复用已判死的 promise（表现为「点了没反应」——
    // 如切歌后回头重点上一首、或同曲二次切音质拿到旧音质的播放）。
    inflightPlayRequests.clear();

    const request = (async () => {

    const requestId = ++playRequestId;

    try {

      // 按歌数睡眠定时到期边界（「听完歌曲后停止」）：不再加载下一首，
      // 保持已播完的当前曲展示并停用定时器。旧实现先加载再暂停，
      // 会短暂闪现下一首标题并漏出淡入声音。
      const pre = get();
      const sleepTimerNext = getNextSongSleepTimerState({
        isActive: pre.sleepTimerSongActive,
        remainingSongs: pre.sleepTimerSongCount,
        lastTrackKey: pre.sleepTimerLastTrackKey,
      }, song);
      if (sleepTimerNext.shouldPause) {
        set({ isPlaying: false, sleepTimerSongActive: false, sleepTimerSongCount: 0 });
        return;
      }

      set({ loading: true, error: null });



      // 确保播放器已初始化

      await ensurePlayerSetup();



      // 淡出当前播放（避免切歌爆音）

      try { await fadeVolume(0, FADE_OUT_MS); } catch {}



      // 竞态检查：已有更新的 play 请求，丢弃本次

      if (requestId !== playRequestId) return;



      await TrackPlayer.reset();

      // reset 与 add 之间存在 await 让出点：并发 play() 可能在本请求 reset 之后、add 之前
      // 完成它自己的 reset，本请求若继续 add 会把旧曲残留在原生单曲槽（音画不一致）。
      // 此处再查一次令牌；检查与 add 调用之间无让出点，可关死该交错窗口。
      if (requestId !== playRequestId) return;

      // 双轨入队：真实曲目 + 2 秒静音占位。
      //
      // 曲末如果队列直接见底，原生播放会停止，Android 随即失去维持进程的理由，
      // JS 线程被挂起 —— 后台切歌就卡住，直到用户回到 app（用户实测现象）。
      // 补一个静音尾轨后，原生队列会自动推进到它，播放状态不中断、前台服务存活，
      // 这 2 秒正是留给 JS 醒来解析下一首的窗口。真正的切歌仍由 JS 决定，
      // 原生不参与队列编排（RepeatMode 依旧 Off）。
      await TrackPlayer.add([
        {
          id: `${song.source}-${song.id}`,

          url,

          title: song.name,

          artist: song.singer || "未知歌手",

          album: song.albumName || "未知专辑",

          artwork: song.picUrl || song.img || undefined,

          duration: song.interval,

          // B站等需要 Referer 的音源通过 headers 传递请求头

          headers: headers ?? undefined,
        },
        {
          id: SILENCE_GAP_TRACK_ID,
          url: SILENCE_GAP_TRACK_URL,
          // 元数据沿用当前曲：这 2 秒仍属于「刚播完的那首」，
          // 通知栏不应闪成空白或下一首
          title: song.name,
          artist: song.singer || "未知歌手",
          album: song.albumName || "未知专辑",
          artwork: song.picUrl || song.img || undefined,
          duration: 0,
        },
      ]);



      // 竞态检查：add 之后再次确认请求仍有效，避免在已过期的请求上继续 setRate/setVolume/play

      if (requestId !== playRequestId) return;



      const { playbackRate, volume, externalDuckVolume } = get();

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

      // 淡入到目标音量：外部音频压低（duck）期间以压低音量为上限，
      // 避免 duck 中自动切歌把音量淡回满格、盖住导航播报等外部音频
      const fadeInTarget = externalDuckVolume != null ? Math.min(volume, externalDuckVolume) : volume;
      void fadeVolume(fadeInTarget, FADE_IN_MS);

      set({
        currentSong: song,
        currentUrl: url,
        isPlaying: true,
        loading: false,
        playbackRate: nextPlaybackRate,
        position: startPosition && startPosition > 0 ? startPosition : 0,
        duration: song.interval || 0,
        sleepTimerSongActive: sleepTimerNext.isActive,
        sleepTimerSongCount: sleepTimerNext.remainingSongs,
        sleepTimerLastTrackKey: sleepTimerNext.lastTrackKey,
      });
      // 新播放会话重新允许试听检测（用户手动重试时再次拦截，防缓存命中后漏网）
      previewRejectedKeys.clear();

    } catch (error) {
      const message = error instanceof Error ? error.message : "播放失败";
      set({
        loading: false,
        error: message,
      });
      throw error;
    }
    })();

    inflightPlayRequests.set(requestKey, request);
    try {
      await request;
    } finally {
      if (inflightPlayRequests.get(requestKey) === request) {
        inflightPlayRequests.delete(requestKey);
      }
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
      if (get().onSilenceGap) {
        // 曲末 2s 静音间隙内的 seek：原生活动轨是占位轨，直接 seekTo 会被按
        // 占位轨时长按比例理解，表现"点了没反应"。映射回真实曲目（index 0）再 seek。
        try {
          await TrackPlayer.skip(0);
        } catch {}
      }
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
    // 立即预取该曲播放 URL/歌词/封面：播到它时命中缓存秒开（避免插播时实时解析）。
    // 懒加载避免 playerStore ↔ playerService 循环依赖。
    void import("../services/playerService").then((m) => m.prefetchSong(song)).catch(() => undefined);
  },

  addToTempPlayList: (song: MusicInfo) => {
    set((state) => ({
      tempPlayList: enqueueTempPlayList({ tempPlayList: state.tempPlayList, song }),
    }));
    void import("../services/playerService").then((m) => m.prefetchSong(song)).catch(() => undefined);
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
let playerListenersSetup = false;

export function setupPlayerListeners() {
  if (playerListenersSetup) return;
  playerListenersSetup = true;

  const updateProgress = usePlayerStore.getState().updateProgress;

  const syncPlayerState = usePlayerStore.getState().syncPlayerState;

  const setError = usePlayerStore.getState().setError;



  // 恢复上次保存的音量（独立通道 af-player-volume，只存 volume 数值）。
  // 播放快照恢复完成后 currentSong 非空：快照携带 volume+previousVolume+isMuted 完整状态，
  // 此时跳过本通道，避免把静音/历史音量覆盖成单一数值造成状态矛盾。
  // 两个 AsyncStorage 恢复无论谁先完成该约束都成立：先完成会被快照整体覆盖，后完成被跳过。
  loadPersistedVolume().then((saved) => {

    if (saved != null && !usePlayerStore.getState().currentSong) {

      usePlayerStore.setState({ volume: saved });

    }

  }).catch(() => {});

  // 播放进度更新
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration, buffered }) => {
    // 静音占位轨期间（曲末 2s 窗口）：position/duration 是占位轨的，
    // 写入会把真实进度污染成 2s 长度；且「明显短于期望时长」恰好命中
    // 试听兜底判定，会造成曲末误报"检测到试听片段"。整段忽略。
    if (usePlayerStore.getState().onSilenceGap) return;
    updateProgress(position, duration, buffered);
    // 试听兜底：解析期拿不到 Content-Length / Content-Range 的流式响应靠播放器实际时长判定。
    // 明显短于期望时长（song.interval）即视为试听：停播 + 清缓存，下次重播强制重新解析（对齐失败即停）。
    const song = usePlayerStore.getState().currentSong;
    if (!song) return;
    const key = `${song.source}:${song.id}`;
    if (previewRejectedKeys.has(key)) return;
    if (isPreviewDuration({ actualDurationSeconds: duration, expectedDurationSeconds: song.interval })) {
      previewRejectedKeys.add(key);
      setError(`检测到试听片段（约 ${Math.round(duration)}s），已清除缓存，请重新播放或切换音源`);
      void TrackPlayer.pause().catch(() => {});
      void invalidateCachedPlaybackUrl(song).catch(() => undefined);
      invalidatePrefetchForSong(song);
    }
  });

  // 播放状态变化
  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    syncPlayerState(state);
  });

  // 原生活动轨切换：进入/离开曲末静音占位轨时打标，供进度忽略与 seek 映射使用。
  // （切歌主逻辑在 playbackService 的同名监听里，这里只维护 UI 状态标记。）
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ track }) => {
    const onSilenceGap = track?.id === SILENCE_GAP_TRACK_ID;
    if (usePlayerStore.getState().onSilenceGap !== onSilenceGap) {
      usePlayerStore.setState({ onSilenceGap });
    }
  });

  // 播放错误：仅展示错误，不再自动跳下一首（用户要求失败即停，手动切歌）。
  // 解析成功但播放器拒收（典型：URL 实际已 403/失效），把该歌持久化 URL 缓存清掉，
  // 避免坏链接被缓存 6h 反复命中「播放即停」；预读缓存同步失效，重播强制重新解析。
  TrackPlayer.addEventListener(Event.PlaybackError, ({ message }) => {
    const currentSong = usePlayerStore.getState().currentSong;
    if (!currentSong) return;
    setError(message);
    void invalidateCachedPlaybackUrl(currentSong).catch(() => undefined);
    invalidatePrefetchForSong(currentSong);
  });

  // 曲末自动切歌不在此注册：该逻辑必须运行在 TrackPlayer 的后台服务上下文
  // （src/player/playbackService.ts），否则 app 退到后台后 JS 挂起，切歌要等
  // 用户回到前台才发生。此处只保留与 UI 状态直接相关的监听。
}





