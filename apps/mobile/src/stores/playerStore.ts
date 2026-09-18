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
  enqueueTempPlayList,
  removeFromTempPlayList as removeFromTempPlayListPure,
} from "@/services/songQueueActions";
import { syncPlaybackParameters } from "@/services/androidPitchService";
import { buildMobilePlayRequestKey } from "@/services/playerRequestModel";
import { invalidateCachedPlaybackUrl } from "@/services/playbackUrlCache";
import {
  decidePlaybackFailureAction,
  notePlaybackHealthy,
  noteRetrySettled,
} from "@/services/playbackFailurePolicy";
import { invalidatePrefetchForSong, prefetchUpcomingSongNearEnd } from "../services/playerService";
import {
  isLyricOverlaySupported,
  playLyricOverlayClock,
  pauseLyricOverlayClock,
  setLyricOverlayClockRate,
} from "@/services/lyricOverlayService";
import { onPlaybackProgress, resetListeningSession } from "@/services/listenTrackerService";



// ── 播放竞态保护 ──

let playRequestId = 0;

// 底层 play 最近一次接管的歌曲 key（play 入口同步登记）。PlaybackError 没有曲目归属，
// 据此做同步归属判定（不引入桥接调用，保住错误处置「必须同步完成」的约定）：
// 切歌在途时它 ≠ currentSong 的 key，迟到的旧曲错误不得触发重播。
let lastQueuedTrackOwnerKey: string | null = null;

/**
 * PlaybackError 归属判定：这条错误是否还能归因给 currentSong。
 * 有更新的播放请求在途（用户已点新歌，play 已带着新曲进入解析/reset/add 流程）时，
 * 错误无论属于正被替换的旧曲还是装车中的新曲，都不再归因 currentSong——
 * 旧曲错误重播会劫持刚点的新歌，新曲错误由其自身 play 流程与后续事件收口。
 */
export function shouldAttributePlaybackErrorToCurrentSong(): boolean {
  const { currentSong } = usePlayerStore.getState();
  if (!currentSong) return false;
  const key = `${currentSong.source}:${currentSong.id}`;
  return lastQueuedTrackOwnerKey === null || lastQueuedTrackOwnerKey === key;
}

// 已判定为试听片段的歌曲 key：进度事件 0.25s 触发一次，防同一首歌重复告警。
const previewRejectedKeys = new Set<string>();

/**
 * 判定「该曲确实可播」的播放位置阈值（秒）：越过它才归还重试额度。
 * 取 5s 是为了越过坏链的报错窗口——实测坏链要到约 3s 后原生才发 PlaybackError，
 * 阈值若落在窗口内会把即将失败的加载误判为健康，重试额度反复归还即成无限重试。
 */
const PLAYBACK_HEALTHY_POSITION_SECONDS = 5;

// 播放失败的重试额度与处置结论由 @/services/playbackFailurePolicy 统一持有：
// 本 store 与后台 playbackService 监听同一条原生事件，各自记账会得出矛盾结论。

// 同 key 播放进入去重（对齐桌面端 inflightPlayRequest）：同 key 的并发 play 复用同一 Promise，
// 避免重复 reset/add 同一 track；不同 key 不去重，仍靠上面的令牌丢弃过期请求。
// key 含音质：同一首歌切换音质后再切，需发起全新 play 而不是复用旧音质的在途请求。
const inflightPlayRequests = new Map<string, Promise<void>>();





/**
 * 曲末静音占位轨。
 *
 * 每首歌入队时跟一条静音占位（raw/silence_2s.wav，现为 15s），使曲末不会因队列见底而停止播放——播放不停，
 * 前台服务就不会被回收，JS 线程有机会在这段窗口内醒来解析并切下一首。
 * 检测到当前活动轨是它，就等同于「上一首播完了」。
 *
 * 包名固定于 android/app/build.gradle 的 applicationId；若修改需同步此处。
 * 音频文件：android/app/src/main/res/raw/silence_2s.wav
 */
export const SILENCE_GAP_TRACK_ID = "__auralflow_silence_gap__";
const SILENCE_GAP_TRACK_URL = "android.resource://cn.chenle.auralflow.mobile/raw/silence_2s";

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

  } catch { /* 读取/解析失败：无持久化音量，回退 null */ }

  return null;

}



export type PlayMode = MobilePlayMode;
export type PlaybackContextType = "queue" | "personalFm" | "heartbeat";

export interface PersonalFmContext {
  type: "personalFm";
  buffer: MusicInfo[];
  currentBatch: MusicInfo[];
  currentBatchIndex: number;
  hasMore: boolean;
}

export interface HeartbeatContext {
  type: "heartbeat";
  seedSongId: string;
  playlistId: string;
  buffer: MusicInfo[];
  currentBatch: MusicInfo[];
  currentBatchIndex: number;
  hasMore: boolean;
}

export type PlaybackContext =
  | { type: "queue" }
  | PersonalFmContext
  | HeartbeatContext;

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
        minBuffer: 8,
        maxBuffer: 30,
        backBuffer: 6,
        // 起播缓冲从 2.5s 降到 1s：切歌后不必等 CDN 填满 2.5s 才出声。
        // 弱网卡顿由 ExoPlayer 自己回缓冲，不靠拉高这个门槛。
        playBuffer: 1.0,
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

// ─ 睡眠定时器 ──
//
// 记账模型：剩余毫秒 sleepTimerRemainingMs + 上次结算时间点 sleepTimerLastReconcileAt。
// 每次结算按「真实经过时间」一次性补扣（仅播放中扣减），而不是靠逐分钟 setTimeout 累加。
// 纯 timer 链在后台会被系统冻结/节流，可能整段不回调（设 30 分钟睡到早上还在放）。
// 三个结算入口共用同一个幂等 reconcile：
//   1) 定时器：前台的分钟级心跳，以及到点唤醒；
//   2) AppState 回到 active：把 timer 冻结期间的欠账一次结清，已到点则立即停；
//   3) 原生进度事件（0.25s 一次）：事件在流时无需等 timer，到点即停。
let sleepTimerId: ReturnType<typeof setTimeout> | null = null;
let sleepTimerRemainingMs = 0;
let sleepTimerLastReconcileAt = 0;
let sleepTimerAppStateSubscription: { remove: () => void } | null = null;

/** 前台心跳上限：到点前每分钟唤醒一次刷新剩余分钟显示即可。 */
const SLEEP_TIMER_HEARTBEAT_MS = 60_000;

/** 进度事件驱动的结算节流：4 次/秒的事件不必每次都重排定时器。 */
const SLEEP_TIMER_EVENT_RECONCILE_INTERVAL_MS = 1_000;

function clearSleepTimerTimeout() {
  if (sleepTimerId) {
    clearTimeout(sleepTimerId);
    sleepTimerId = null;
  }
}

function ensureSleepTimerAppStateListener() {
  if (sleepTimerAppStateSubscription) return;
  sleepTimerAppStateSubscription = AppState.addEventListener("change", (state) => {
    // 后台 timer 被冻结期间账没结：回前台立即按真实经过时间补扣
    if (state === "active") reconcileSleepTimer();
  });
}

function resetSleepTimerAccounting() {
  sleepTimerRemainingMs = 0;
  sleepTimerLastReconcileAt = Date.now();
}

/** 播放/暂停切换时重置结算基准，避免把暂停期间的时间算进播放时长。 */
function syncSleepTimerClock() {
  sleepTimerLastReconcileAt = Date.now();
}

function scheduleSleepTimerTimeout() {
  clearSleepTimerTimeout();
  if (!usePlayerStore.getState().sleepTimerActive) return;
  sleepTimerId = setTimeout(() => {
    sleepTimerId = null;
    reconcileSleepTimer();
  }, Math.max(0, Math.min(sleepTimerRemainingMs, SLEEP_TIMER_HEARTBEAT_MS)));
}

/**
 * 结算睡眠定时（幂等）：按真实经过时间补扣剩余时长。
 * 暂停中只推进时间点不扣减（对齐主流语义：只统计实际播放时长）。
 */
function reconcileSleepTimer(): void {
  const { sleepTimerActive, sleepTimerMinutes, isPlaying } = usePlayerStore.getState();
  if (!sleepTimerActive || sleepTimerMinutes == null) return;

  const now = Date.now();
  const elapsed = Math.max(0, now - sleepTimerLastReconcileAt);
  sleepTimerLastReconcileAt = now;

  if (isPlaying) {
    sleepTimerRemainingMs = Math.max(0, sleepTimerRemainingMs - elapsed);
    if (sleepTimerRemainingMs <= 0) {
      // 时间到：停播并清状态（不再重排心跳）
      clearSleepTimerTimeout();
      resetSleepTimerAccounting();
      usePlayerStore.setState({ sleepTimerMinutes: null, sleepTimerActive: false });
      usePlayerStore.getState().pause().catch(() => undefined);
      return;
    }
    const nextMinutes = Math.max(1, Math.ceil(sleepTimerRemainingMs / 60_000));
    if (nextMinutes !== sleepTimerMinutes) {
      usePlayerStore.setState({ sleepTimerMinutes: nextMinutes });
    }
  }

  scheduleSleepTimerTimeout();
}

/** 进度事件驱动入口：节流后走同一次结算。 */
function maybeReconcileSleepTimer(): void {
  if (!usePlayerStore.getState().sleepTimerActive) return;
  if (Date.now() - sleepTimerLastReconcileAt < SLEEP_TIMER_EVENT_RECONCILE_INTERVAL_MS) return;
  reconcileSleepTimer();
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

  // 心动模式上下文
  setHeartbeatContext: (payload: {
    seedSongId: string;
    playlistId: string;
    currentBatch: MusicInfo[];
    currentBatchIndex: number;
    buffer?: MusicInfo[];
    hasMore?: boolean;
  }) => void;
  setHeartbeatBatchIndex: (index: number) => void;
  appendHeartbeatBuffer: (songs: MusicInfo[], hasMore?: boolean) => void;

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
    // 登记本次 play 接管的歌曲：此后到 currentSong 落库前到达的 PlaybackError
    // 一律不归因旧 currentSong（见 shouldAttributePlaybackErrorToCurrentSong）。
    lastQueuedTrackOwnerKey = `${song.source}:${song.id}`;
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

      // 竞态检查：已有更新的 play 请求，丢弃本次

      if (requestId !== playRequestId) return;



      // 切歌不 reset：reset 会拆掉 ExoPlayer 音频管线（停 AudioTrack、清缓冲、关 WakeLock），
      // 下一首要从零重建，听感就是「卡一下」。对齐 lx：新曲接到队尾 → skip 过去 → 再删旧轨。
      let previousQueueLength = 0;
      try {
        previousQueueLength = (await TrackPlayer.getQueue()).length;
      } catch {
        previousQueueLength = 0;
      }
      if (requestId !== playRequestId) return;

      // 双轨入队：真实曲目 + 静音占位（文件已扩到 15s，仅作后台保活窗口）。
      // 曲末队列见底会停播，Android 随即失去维持进程的理由；静音尾轨让前台服务继续存活。
      const nextTracks = [
        {
          id: `${song.source}-${song.id}`,
          url,
          title: song.name,
          artist: song.singer || "未知歌手",
          album: song.albumName || "未知专辑",
          artwork: song.picUrl || song.img || undefined,
          duration: song.interval,
          headers: headers ?? undefined,
        },
        {
          id: SILENCE_GAP_TRACK_ID,
          url: SILENCE_GAP_TRACK_URL,
          title: song.name,
          artist: song.singer || "未知歌手",
          album: song.albumName || "未知专辑",
          artwork: song.picUrl || song.img || undefined,
          duration: 0,
        },
      ];
      await TrackPlayer.add(nextTracks);
      if (requestId !== playRequestId) return;

      const newSongIndex = previousQueueLength;
      try {
        await TrackPlayer.skip(newSongIndex, startPosition && startPosition > 0 ? startPosition : 0);
      } catch {
        // 空队列首次入队时 skip 可能多余，继续 play 即可
      }
      if (requestId !== playRequestId) return;

      // 先出声再清旧轨：remove 会再触发一次轨道切换事件，不必挡在 play() 前面。
      if (previousQueueLength > 0) {
        const staleIndexes = Array.from({ length: previousQueueLength }, (_, i) => i);
        void TrackPlayer.remove(staleIndexes).catch(() => undefined);
      }

      if (requestId !== playRequestId) return;



      const { playbackRate, volume, externalDuckVolume } = get();

      const nextPlaybackRate = clampPlaybackRate(playbackRate);
      await TrackPlayer.setRate(nextPlaybackRate);
      // 无淡入淡出：入原生前直接落到目标音量。外部音频压低（duck）期间以压低音量为上限，
      // 避免 duck 中自动切歌把音量拉回满格、盖住导航播报等外部音频。
      const targetVolume = externalDuckVolume != null ? Math.min(volume, externalDuckVolume) : volume;
      await TrackPlayer.setVolume(targetVolume);
      await TrackPlayer.play();

      if (requestId !== playRequestId) return;

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
        error: message,
      });
      throw error;
    } finally {
      // loading 的兜底出口：竞态令牌提前 return、睡眠定时到期 return、异常、正常完成
      // 都会走到这里。只有本次仍是最新请求时才落回 false —— 已被新请求接管时
      // loading 归它管，这里照写会抹掉新请求刚点亮的加载态；反之若完全不写，设过
      // loading:true 后走提前 return 的路径会把 UI 永久钉在加载中（转圈不停、按钮点不动）。
      // 成功路径已连同 currentSong 原子置过 false，故先读一下避开多余的 set 广播。
      if (requestId === playRequestId && get().loading) {
        set({ loading: false });
      }
    }
    })();

    inflightPlayRequests.set(requestKey, request);

    // 清理绑定在 promise 自身而不是调用方的 await 上：调用方若不等待（或提前放弃等待），
    // 已 settle 的死条目会留在 Map 里，后续同 key 点击复用它就表现为「点了没反应」。
    const clearInflightRequest = () => {
      // 仅删自己登记的那一条：新请求已通过上面的 clear/set 顶掉本条时不能再删，
      // 否则会连带清掉当前有效的在途请求。
      if (inflightPlayRequests.get(requestKey) === request) {
        inflightPlayRequests.delete(requestKey);
      }
    };
    void request.then(clearInflightRequest, clearInflightRequest);

    return request;
  },

  pause: async () => {
    // 播放器未 setup（如快照恢复后尚未播放）时无原生可暂停，仅同步 UI 状态。
    if (!isPlayerSetup) {
      set({ isPlaying: false });
      return;
    }
    try {
      await TrackPlayer.pause();
    } catch { /* 原生 pause 失败：仍落 UI 暂停态 */ }
    // 暂停即重置结算基准：暂停期间不倒数
    syncSleepTimerClock();
    set({ isPlaying: false });
  },

  resume: async () => {
    // 未 setup 时没有已加载的 track，无法 resume；忽略以避免调用未初始化的原生播放器。
    if (!isPlayerSetup) return;
    try {
      await TrackPlayer.play();
    } catch { /* 原生 play 失败：由下方状态回读纠偏 */ }
    // 续播即重置结算基准：暂停期间的时间不计入睡眠时长
    syncSleepTimerClock();
    // 原生处于 IDLE/ENDED（加载失败停播、清队列、顺序播完）时 play() 是 no-op，
    // 且不会再派发 PlaybackState 事件纠偏——必须回读原生状态才落库，否则 UI 进入
    // 假播放态（有进度无声音），PlayerBar 的快照续播兜底（!isPlaying 才触发）也永不可达。
    let nativePlaying = false;
    try {
      const state = await TrackPlayer.getState();
      nativePlaying = state === State.Playing || state === State.Buffering;
    } catch { /* 回读失败：按未播放落库，避免假播放态 */ }
    set({ isPlaying: nativePlaying });
  },

  stop: async () => {
    resetListeningSession();
    if (!isPlayerSetup) {
      set({ isPlaying: false, position: 0 });
      return;
    }
    try {
      await TrackPlayer.stop();
    } catch { /* 原生 stop 失败：仍清空 UI 播放态 */ }
    syncSleepTimerClock();
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
        } catch { /* 占位轨 skip 失败：继续按原位置 seek */ }
      }
      await TrackPlayer.seekTo(position);
    } catch { /* seek 失败：仍落 UI 位置 */ }
    set({ position });
    if (isLyricOverlaySupported() && get().isPlaying) {
      void playLyricOverlayClock(position).catch(() => {});
    }
  },

  setPlaybackRate: async (rate: number) => {
    const nextRate = clampPlaybackRate(rate);
    set({ playbackRate: nextRate });
    await syncPlaybackParameters();
    if (isLyricOverlaySupported()) {
      void setLyricOverlayClockRate(nextRate).catch(() => {});
    }
  },

  setVolume: async (volume: number) => {

    const next = getNextVolumeState(get(), volume);

    // 未 setup 时仅记录音量，下次 play() 会通过 setVolume 应用。

    if (isPlayerSetup) {

      try {

        await TrackPlayer.setVolume(next.volume);

      } catch { /* 原生 setVolume 失败：下次 play 会重新应用 */ }

    }

    set(next);

    persistVolume(next.volume);

  },



  toggleMute: async () => {

    const next = getNextMuteState(get());

    if (isPlayerSetup) {

      try {

        await TrackPlayer.setVolume(next.volume);

      } catch { /* 原生 setVolume 失败：下次 play 会重新应用 */ }

    }

    set(next);

    persistVolume(next.volume);

  },

  // 睡眠定时器
  startSleepTimer: (minutes: number) => {
    clearSleepTimerTimeout();
    const m = Math.max(0, Math.floor(minutes));
    if (m <= 0) {
      resetSleepTimerAccounting();
      set({ sleepTimerMinutes: null, sleepTimerActive: false });
      return;
    }
    ensureSleepTimerAppStateListener();
    sleepTimerRemainingMs = m * 60_000;
    sleepTimerLastReconcileAt = Date.now();
    set({
      sleepTimerMinutes: m,
      sleepTimerActive: true,
      sleepTimerSongCount: 0,
      sleepTimerSongActive: false,
      sleepTimerLastTrackKey: null,
    });
    scheduleSleepTimerTimeout();
  },

  startSongSleepTimer: (songCount: number) => {
    clearSleepTimerTimeout();
    resetSleepTimerAccounting();
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
    resetSleepTimerAccounting();
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
    } catch { /* 未 setup 时 stop 会 reject：忽略，照常清空队列 */ }
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

  // 心动模式上下文
  setHeartbeatContext: ({ seedSongId, playlistId, currentBatch, currentBatchIndex, buffer = [], hasMore = true }) => {
    set({
      playbackContext: {
        type: "heartbeat",
        seedSongId,
        playlistId,
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

  setHeartbeatBatchIndex: (index: number) => {
    set((state) => {
      if (state.playbackContext.type !== "heartbeat") {
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

  appendHeartbeatBuffer: (songs: MusicInfo[], hasMore = true) => {
    set((state) => {
      if (state.playbackContext.type !== "heartbeat") {
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
    } catch { /* 未 setup 或原生异常：仅保留 UI 模式状态 */ }
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
    // 原生事件驱动的播放/暂停切换（如音频焦点中断）同样重置结算基准
    if (isPlaying !== get().isPlaying) {
      syncSleepTimerClock();
      if (isLyricOverlaySupported()) {
        if (state === State.Playing) {
          void playLyricOverlayClock(get().position).catch(() => {});
        } else if (state === State.Paused || state === State.Stopped) {
          void pauseLyricOverlayClock().catch(() => {});
        }
      }
    }
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
    // 睡眠定时器的进度驱动结算：后台 timer 可能被冻结，只要进度事件在流就能到点停播
    maybeReconcileSleepTimer();
    // 静音占位轨期间（曲末 2s 窗口）：position/duration 是占位轨的，
    // 写入会把真实进度污染成 2s 长度；且「明显短于期望时长」恰好命中
    // 试听兜底判定，会造成曲末误报"检测到试听片段"。整段忽略。
    if (usePlayerStore.getState().onSilenceGap) return;
    updateProgress(position, duration, buffered);
    // 听歌时长追踪：连续播放满 2 分钟或 50% 时记录历史与网易云打点
    onPlaybackProgress(position, usePlayerStore.getState().isPlaying);
    // 曲末提前预解析下一首：剩余 10s 内触发一次（内部按「当前曲→下一首」组合与
    // 预读 key 双重去重，0.25s 的进度事件不会重复解析）。无下一首/单曲循环无副作用。
    prefetchUpcomingSongNearEnd(position, duration);
    // 试听兜底：解析期拿不到 Content-Length / Content-Range 的流式响应靠播放器实际时长判定。
    // 明显短于期望时长（song.interval）即视为试听：停播 + 清缓存，下次重播强制重新解析（对齐失败即停）。
    const song = usePlayerStore.getState().currentSong;
    if (!song) return;
    const key = `${song.source}:${song.id}`;
    // 位置推进过阈值即证明该曲可播（音频真的在解码）：归还其重试额度，
    // 使下次遇到坏链时仍能重新走「重试一次 → 再失败才跳」，而非一失败就直接跳。
    if (position >= PLAYBACK_HEALTHY_POSITION_SECONDS) notePlaybackHealthy(key);
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
    if (onSilenceGap) {
      resetListeningSession();
    }
    if (usePlayerStore.getState().onSilenceGap !== onSilenceGap) {
      usePlayerStore.setState({ onSilenceGap });
    }
  });

  // 播放错误：解析成功但播放器拒收（典型：URL 实际已 403/失效），先把该歌持久化 URL
  // 缓存清掉，避免坏链接被缓存 6h 反复命中「播放即停」；预读缓存同步失效，重播强制重新解析。
  // 清完缓存后对同一首歌自动重播一次（多数 403 靠重新解析即可救回）；重试仍失败只报错，
  // 不在此自动跳下一首。
  TrackPlayer.addEventListener(Event.PlaybackError, ({ message }) => {
    const currentSong = usePlayerStore.getState().currentSong;
    if (!currentSong) return;
    const retryKey = `${currentSong.source}:${currentSong.id}`;

    // 归属守卫：切歌在途（见 shouldAttributePlaybackErrorToCurrentSong）时只清旧曲
    // 坏链缓存、不发起重播——重播会劫持刚点的新歌或把在播的新曲从头重启。
    if (!shouldAttributePlaybackErrorToCurrentSong()) {
      void invalidateCachedPlaybackUrl(currentSong).catch(() => undefined);
      invalidatePrefetchForSong(currentSong);
      return;
    }

    // 处置判定必须同步完成：后台服务在让出一个微任务后回读本结论决定是否跳歌
    if (decidePlaybackFailureAction(retryKey) === "skip") {
      // 重试额度已用掉 → 终局失败。仍清坏链缓存（下次重播强制重新解析），
      // 跳下一首由后台 playbackService 发起：app 退到后台后这里跳不动。
      setError(message);
      void invalidateCachedPlaybackUrl(currentSong).catch(() => undefined);
      invalidatePrefetchForSong(currentSong);
      return;
    }

    const retryIndex = usePlayerStore.getState().currentIndex;
    const retryQueueSong = usePlayerStore.getState().queue[retryIndex];

    void (async () => {
      try {
        // 必须等缓存真正失效再重播，否则重解析会命中同一条坏链接
        await invalidateCachedPlaybackUrl(currentSong).catch(() => undefined);
        invalidatePrefetchForSong(currentSong);
        // 等待期间用户已切歌：本次重播作废，不劫持新的播放意图
        if (usePlayerStore.getState().currentSong !== currentSong) return;
        const { playFromQueue, playSong } = await import("../services/playerService");
        // 队列该位置仍是本曲时走 playFromQueue，保留队列/FM 上下文与索引语义；
        // 队列已变动则退回按歌曲重播。
        const sameQueueSlot =
          retryQueueSong != null &&
          retryQueueSong.source === currentSong.source &&
          String(retryQueueSong.id) === String(currentSong.id);
        if (sameQueueSlot) {
          await playFromQueue(retryIndex);
        } else {
          await playSong(currentSong);
        }
      } catch {
        setError(message);
      } finally {
        // 解除在途标记：此后同曲再报错即判终局，由后台服务跳下一首
        noteRetrySettled(retryKey);
      }
    })();
  });

  // 曲末自动切歌不在此注册：该逻辑必须运行在 TrackPlayer 的后台服务上下文
  // （src/player/playbackService.ts），否则 app 退到后台后 JS 挂起，切歌要等
  // 用户回到前台才发生。此处只保留与 UI 状态直接相关的监听。
}





