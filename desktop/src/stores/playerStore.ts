import { create } from "zustand";
import type { MusicInfo } from "@lx/core";
import { playerEngine } from "@/services/playerEngine";
import { resolvePlaybackUrl } from "@/services/playback/playbackResolver";
import { prefetchNearbyTracks, prefetchTracks, getPrefetchedTrack, invalidatePrefetchedTrack } from "@/services/playback/prefetchService";
import { selectCachedPlaybackTarget } from "@/services/playback/prefetchModel";
import { getPlayModeState, type PlayModeId } from "@/services/playback/playModeControl";
import { invalidateCachedPlaybackUrl } from "@/services/persistentCache";
import { debugLog, patchSettings } from "@lx/tauri-bridge";
import { applySwitchStepRequest, createSwitchStepQueueState, finishSwitchStep } from "@lx/core";
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

  /** progress 的 engine 采样时刻（performance.now() 基准）；主窗口构造跨 WebView 快照时转换为 wall clock */

  progressSampledAt: number;
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

  /** FM 模式下已播过的曲目栈（不在 queue 里，prev() 需要它回退） */

  fmHistory: MusicInfo[];

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
  enterFmMode: (options?: { soft?: boolean }) => void;
  exitFmMode: () => void;
}

let volumePersistTimer: ReturnType<typeof setTimeout> | null = null;
let activePlayRequestId = 0;

// 切歌连点合并：切换进行中（解析/播放器加载）时重复点击只补跳一次，不重复解析。
let switchStepQueue = createSwitchStepQueueState();
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

async function invalidatePersistentPlaybackCache(
  original: MusicInfo,
  target: MusicInfo,
  quality?: string,
): Promise<void> {
  try {
    await invalidateCachedPlaybackUrl(original, quality);
    if (target.source !== original.source || target.id !== original.id) {
      await invalidateCachedPlaybackUrl(target, quality);
    }
  } catch (error) {
  }
}

function invalidatePlayRequest() {
  activePlayRequestId += 1;
  inflightPlayRequest = null;
}

function scheduleVolumePersist(volume: number) {
  if (volumePersistTimer) clearTimeout(volumePersistTimer);
  volumePersistTimer = setTimeout(() => {
    volumePersistTimer = null;
    patchSettings({ volume: Math.round(volume * 100) }).catch(() => undefined);
  }, 400);
}

/** 调用 discoveryStore.fmNext 后播放下一首 FM 曲目；失败返回 false */
/** FM 下一首：解析/播放失败时最多再试几首，避免卡在死链上 */
/** 当前切歌完成后消费连点补跳（只补一次，防止循环）。 */
function completeQueuedSwitchStep(get: any): void {
  const finished = finishSwitchStep(switchStepQueue);
  switchStepQueue = finished.nextState;
  if (finished.shouldStep) {
    void (finished.direction === 'prev' ? get().prev() : get().next()).catch(() => undefined);
  }
}

async function playNextFmTrack(get: any, maxAttempts = 5): Promise<boolean> {
  let lastError = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const next = await useDiscoveryStore.getState().fmNext();
      if (!next) {
        // 队列耗尽/拉取失败：不再静默，写入用户可见的错误，避免“点了没反应”
        const fmState = useDiscoveryStore.getState();
        lastError = fmState.fmError || '私人 FM 暂无更多推荐（可能需要重新登录）';
        break;
      }
      const failed = await playAndDidFail(get, next);
      if (!failed) return true;
      lastError = 'FM 曲目解析失败，已自动跳过';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  usePlayerStore.setState({ error: `私人 FM 切歌失败：${lastError}` });
  return false;
}

/** 预热当前曲目附近的 URL、歌词和封面，切歌与看歌词时更快可用。 */
async function preloadNext(get: any): Promise<void> {
  const { queue, currentIndex, repeatMode, isShuffle, fmMode } = get();
  if (fmMode) {
    // FM 模式：预取 discoveryStore 队列中接下来的 1-2 首（URL/歌词/封面），
    // 否则每次「下一首」都实时走完整解析链，正是 FM 切歌慢的根因。
    const { fmQueue, fmIndex } = useDiscoveryStore.getState();
    const upcoming = [fmQueue[fmIndex], fmQueue[fmIndex + 1]].filter(
      (track): track is MusicInfo => !!track,
    );
    if (upcoming.length > 0) await prefetchTracks(upcoming);
    return;
  }
  await prefetchNearbyTracks({ queue, currentIndex, repeatMode, isShuffle, fmMode });
}

/** 播放失败自动下一首（设置项，默认关闭）；FM 模式连播不受此开关影响 */
let playbackFailedAutoNext = false;

export function setPlaybackFailedAutoNext(value: unknown) {
  playbackFailedAutoNext = value === true;
}

const syncEngineToStore = (set: any, get: any) => {
  /** Previous engine status: detect mid-play error vs resolve failure */
  let previousEngineStatus: PlayerStore["status"] | "idle" = "idle";
  let autoSkipTimer: ReturnType<typeof setTimeout> | null = null;

  playerEngine.subscribe((engineState) => {
    const { isMuted, volume: storeVolume } = get() as PlayerStore;
    const prevStatus = previousEngineStatus;
    previousEngineStatus = engineState.status;

    set({
      status: engineState.status,
      progress: engineState.currentTime,
      // 锚点用 engine 采样时刻（同帧），UI 外推不再重复计入 React 渲染延迟
      progressSampledAt: engineState.currentTimeSampledAt,
      duration: engineState.duration,
      // While muted, engine volume is 0; keep store logical volume for unmute/slider
      volume: isMuted ? storeVolume : engineState.volume,
      playbackRate: engineState.playbackRate,
      current: engineState.currentMusic,
      error: engineState.error,
    });

    // 普通队列：仅 playing→error 自动跳（loading→error 由 playAndDidFail 处理），由设置开关控制
    // FM 模式：始终自动跳，loading→error 也要跳，否则推荐死链会卡死
    // 仅在真正跨入 error 时记一次：error 停留期间引擎仍可能推状态，
    // 无条件记录会把同一次失败放大成每帧一条日志（每条还是一次 Tauri IPC）。
    if (engineState.status === "error" && prevStatus !== "error") {
      const currentName = (get() as PlayerStore).current?.name ?? "?";
      const errMsg = engineState.error ? String(engineState.error) : "unknown";
      debugLog(`[engine] 播放错误 status=${prevStatus}->error 歌曲=${currentName} 错误=${errMsg} url=${(engineState.currentUrl ?? "").slice(0, 80)}`);
      // 解析成功但播放器拒收（典型：lx 代理返回的地址实际不可播），把该曲的
      // 持久化 URL 与预读缓存一并作废，否则坏链会被缓存 6h 反复命中「一播就错」。
      // 对齐移动端 Event.PlaybackError 的处置。
      const failed = (get() as PlayerStore).current;
      if (failed) {
        void invalidateCachedPlaybackUrl(failed).catch(() => undefined);
        invalidatePrefetchedTrack(failed);
      }
    }
    const fmMode = (get() as PlayerStore).fmMode;
    const shouldAutoSkip =
      engineState.status === "error" &&
      ((prevStatus === "playing" && (fmMode || playbackFailedAutoNext)) ||
        (prevStatus === "loading" && fmMode));
    if (shouldAutoSkip) {
      if (autoSkipTimer) clearTimeout(autoSkipTimer);
      autoSkipTimer = setTimeout(() => {
        autoSkipTimer = null;
        const store = get() as PlayerStore;
        if (store.status !== "error") return;
        if (store.fmMode) {
          void playNextFmTrack(get);
          return;
        }
        store.next().catch(() => undefined);
      }, 250);
    }
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
      get().play(queue[currentIndex]).catch(() => undefined);
    } else {
      get().next().catch(() => undefined);
    }
  });
};

export const usePlayerStore = create<PlayerStore>((set, get) => {
  syncEngineToStore(set, get);

  // 试听兜底（与移动端一致）：解析期拿不到长度头的流式响应靠播放器实际时长判定。
  // 判定即停播并失效持久化/预读缓存，下次重播强制重新解析（对齐失败即停哲学）。
  playerEngine.onPreviewDetected((duration) => {
    const current = get().current;
    if (!current) return;
    void invalidatePersistentPlaybackCache(current, current);
    invalidatePrefetchedTrack(current);
    playerEngine.pause();
    set({
      status: "error",
      error: `检测到试听片段（约 ${Math.round(duration)}s），已清除缓存，请重新播放或切换音源`,
    });
  });

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

    fmMode: false,

    playHistory: [],
    fmHistory: [],



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
          let playedMusic = music;
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
              playedMusic = cachedTarget.music;
              await playerEngine.play(cachedTarget.music, cachedTarget.url);
            } catch (cachedError) {
              invalidatePrefetchedTrack(music);
              if (cachedTarget.music.source !== music.source || cachedTarget.music.id !== music.id) {
                invalidatePrefetchedTrack(cachedTarget.music);
              }
              if (cachedTarget.fromPersistentCache) {
                await invalidatePersistentPlaybackCache(music, cachedTarget.music, cachedTarget.quality);
              }

              const resolved = await resolvePlaybackUrl(music, variants, undefined, { bypassCache: true });
              if (requestId !== activePlayRequestId) return;

              if (!resolved?.url) {
                throw cachedError;
              }

              playedMusic = resolved.music;
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

            try {
              playedMusic = resolved.music;
              await playerEngine.play(resolved.music, resolved.url);
            } catch (playbackError) {
              if (!resolved.fromCache) throw playbackError;

              await invalidatePersistentPlaybackCache(music, resolved.music, resolved.quality);
              const refreshed = await resolvePlaybackUrl(music, variants, undefined, { bypassCache: true });
              if (requestId !== activePlayRequestId) return;
              playedMusic = refreshed.music;
              await playerEngine.play(refreshed.music, refreshed.url);
            }

          }
          if (requestId !== activePlayRequestId) return;
          useHistoryStore.getState().add(playedMusic);
          preloadNext(get);
        } catch (e) {
          if (requestId !== activePlayRequestId) return;
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

        return { queue: nextQueue, playHistory };

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
        play(current).catch(() => undefined);
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
        progressSampledAt: Date.now(),
        duration: 0,
        error: null,
        playHistory: [],

      });

    },

    next: async () => {

      const { queue, currentIndex, repeatMode, isShuffle, fmMode, playHistory } = get();



      // FM 模式：放弃 queue 逻辑，拉下一首推荐
      if (fmMode) {
        // 把当前曲压入 FM 历史栈，供 prev() 回退（FM 无 queue，prev 原先是无反应的）
        if (get().current) {
          set((state) => ({ fmHistory: [...state.fmHistory.slice(-49), state.current!] }));
        }
        await playNextFmTrack(get);
        return;
      }



      if (queue.length === 0) {

        playerEngine.pauseAtEnd();

        return;

      }



      // 连点合并：切换进行中（解析/播放器加载）时重复点击只补跳一次，不重复解析。
      const step = applySwitchStepRequest(switchStepQueue, "next");
      switchStepQueue = step.nextState;
      if (!step.startNow) return;
      try {

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
        debugLog(`[player] next 失败，已回滚到 index=${prevIndex}`);

      }

      } finally {
        completeQueuedSwitchStep(get);
      }

    },



    prev: async () => {
      const { queue, currentIndex, isShuffle, playHistory, fmMode, fmHistory, current } = get();

      // FM 模式：从 FM 历史栈回退；无历史时回到当前曲开头（对齐移动端语义）
      if (fmMode) {
        const lastTrack = fmHistory.length > 0 ? fmHistory[fmHistory.length - 1] : null;
        if (lastTrack) {
          set({ fmHistory: fmHistory.slice(0, -1) });
          await get().play(lastTrack);
          return;
        }
        if (current) {
          playerEngine.seek(0);
          return;
        }
        return;
      }

      if (queue.length === 0) return;



      // 连点合并：切换进行中（解析/播放器加载）时重复点击只补跳一次，不重复解析。
      const step = applySwitchStepRequest(switchStepQueue, "prev");
      switchStepQueue = step.nextState;
      if (!step.startNow) return;
      try {

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
        debugLog(`[player] prev 失败，已回滚到 index=${savedIndex}`);

      }

      } finally {
        completeQueuedSwitchStep(get);
      }

    },

    setProgress: (progress) => {
      playerEngine.seek(progress);
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

        playerEngine.setVolume(0);

        set({ isMuted: true });

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
  };
});
