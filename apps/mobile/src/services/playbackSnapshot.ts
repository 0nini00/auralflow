import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import type { MusicInfo } from "@lx/core";
import { usePlayerStore, type PlayMode, type PlaybackContext } from "../stores/playerStore";
import { clampPlaybackRate, DEFAULT_PLAYBACK_RATE } from "@/services/playerRateModel";
import { normalizePersistedVolumeState } from "@/services/playerVolumeModel";
import { logger } from "@/services/logger";
import { loadLyricsForRestoredSong } from "./playerService";
import { getPlaybackSnapshotSaveTrigger, isPlaybackSnapshotEmpty, isRetiredHeartbeatContext } from "./playbackSnapshotModel";

const SNAPSHOT_KEY = "auralflow:playback-snapshot:v1";
const SAVE_DEBOUNCE_MS = 1500;

/**
 * 可持久化的播放快照。私人 FM 上下文仅恢复队列部分（缓冲需重新拉取）。
 */
export interface PlaybackSnapshot {
  currentSong: MusicInfo | null;
  queue: MusicInfo[];
  currentIndex: number;
  shuffleHistory: number[];
  position: number;
  duration: number;
  playMode: PlayMode;
  playbackRate: number;
  volume: number;
  previousVolume: number;
  isMuted: boolean;
  playbackContext: PlaybackContext;
  savedAt: number;
}

interface PersistedSnapshot {
  currentSong: MusicInfo | null;
  queue: MusicInfo[];
  currentIndex: number;
  shuffleHistory: number[];
  position: number;
  duration: number;
  playMode: PlayMode;
  playbackRate: number;
  volume: number;
  previousVolume: number;
  isMuted: boolean;
  // 只持久化 queue 上下文；personalFm 的缓冲无法离线恢复
  playbackContext: PlaybackContext;
  savedAt: number;
}

function buildSnapshot(): PersistedSnapshot {
  const state = usePlayerStore.getState();
  return {
    currentSong: state.currentSong,
    queue: state.queue,
    currentIndex: state.currentIndex,
    shuffleHistory: state.shuffleHistory,
    position: state.position,
    duration: state.duration,
    playMode: state.playMode,
    playbackRate: state.playbackRate,
    volume: state.volume,
    previousVolume: state.previousVolume,
    isMuted: state.isMuted,
    playbackContext: state.playbackContext,
    savedAt: Date.now(),
  };
}

let snapshotWriteQueue: Promise<void> = Promise.resolve();

function enqueueSnapshotWrite(operation: () => Promise<void>): Promise<void> {
  const next = snapshotWriteQueue.then(operation, operation);
  snapshotWriteQueue = next.catch(() => undefined);
  return next;
}

/** 保存当前播放状态到 AsyncStorage。 */
export async function savePlaybackSnapshot(): Promise<void> {
  const snapshot = buildSnapshot();
  await enqueueSnapshotWrite(async () => {
    if (isPlaybackSnapshotEmpty(snapshot)) {
      await AsyncStorage.removeItem(SNAPSHOT_KEY);
      return;
    }
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  });
}

/** 从 AsyncStorage 恢复播放状态（仅恢复队列/当前歌曲/模式，不自动播放）。 */
export async function loadPlaybackSnapshot(): Promise<PlaybackSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PersistedSnapshot>;
    if (!data || (!data.currentSong && (!data.queue || data.queue.length === 0))) {
      return null;
    }

    // 心动模式已下线，但旧版本写下的快照仍可能带着它的上下文。当时 queue / currentIndex
    // 与推荐批次保持同步，按普通队列恢复即可，丢掉的只有还没播到的推荐缓冲。
    // 不能静默：用户看到的是「重启后不再接着推荐」，日志里要查得到原因。
    if (isRetiredHeartbeatContext(data.playbackContext)) {
      logger.warn("[播放快照] 快照带有已下线的心动模式上下文，已按普通队列恢复");
    }

    const restoredVolume = normalizePersistedVolumeState({
      volume: data.volume,
      previousVolume: data.previousVolume,
      isMuted: data.isMuted,
    });

    const snapshot: PlaybackSnapshot = {
      currentSong: data.currentSong ?? null,
      queue: Array.isArray(data.queue) ? data.queue : [],
      currentIndex: typeof data.currentIndex === "number" ? data.currentIndex : -1,
      shuffleHistory: Array.isArray(data.shuffleHistory) ? data.shuffleHistory.filter((index) => typeof index === "number") : [],
      position: typeof data.position === "number" ? data.position : 0,
      duration: typeof data.duration === "number" ? data.duration : 0,
      playMode: data.playMode ?? "list",
      playbackRate: clampPlaybackRate(data.playbackRate ?? DEFAULT_PLAYBACK_RATE),
      volume: restoredVolume.volume,
      previousVolume: restoredVolume.previousVolume,
      isMuted: restoredVolume.isMuted,
      // 只有 queue 上下文原样恢复：personalFm 的缓冲无法离线恢复，
      // 已下线的心动模式上下文（上面已记日志）同样退化为 queue
      playbackContext:
        data.playbackContext && data.playbackContext.type === "queue"
          ? data.playbackContext
          : { type: "queue" },
      savedAt: data.savedAt ?? 0,
    };

    // 写回 store（不触发播放）
    usePlayerStore.setState({
      currentSong: snapshot.currentSong,
      queue: snapshot.queue,
      currentIndex: snapshot.currentIndex,
      shuffleHistory: snapshot.shuffleHistory,
      position: snapshot.position,
      duration: snapshot.duration,
      playMode: snapshot.playMode,
      playbackRate: snapshot.playbackRate,
      volume: snapshot.volume,
      previousVolume: snapshot.previousVolume,
      isMuted: snapshot.isMuted,
      playbackContext: snapshot.playbackContext,
      isPlaying: false,
    });

    // 快照不携带歌词：重启后的暂停态补拉当前曲歌词（缓存优先，失败静默），
    // 否则沉浸页歌词页/迷你歌词在下次播放前一直显示「暂无歌词」
    if (snapshot.currentSong) {
      void loadLyricsForRestoredSong(snapshot.currentSong).catch(() => undefined);
    }

    return snapshot;
  } catch (error) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 订阅 store 变化，debounce 保存
// ─────────────────────────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribed = false;
let unsubscribeFn: (() => void) | null = null;
let initializationPromise: Promise<void> | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void savePlaybackSnapshot().catch((error) => {
      logger.error("[播放快照] 保存失败", error);
    });
  }, SAVE_DEBOUNCE_MS);
}

function saveImmediately(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  void savePlaybackSnapshot().catch((error) => {
    logger.error("[播放快照] 保存失败", error);
  });
}

/**
 * 初始化播放快照持久化：启动时恢复一次，并订阅 store 变化 debounce 保存。
 * 应在应用启动时调用一次。
 * 恢复完成后再挂订阅：避免恢复期间其它启动写入（如音量恢复）触发 debounce 保存，
 * 把尚未恢复的默认状态覆盖到磁盘快照上。
 */
export function initPlaybackSnapshotPersistence(): void {
  if (unsubscribeFn || initializationPromise) return;
  unsubscribed = false;

  initializationPromise = (async () => {
    await loadPlaybackSnapshot();
    if (unsubscribed) return;

    unsubscribeFn = usePlayerStore.subscribe((state, prevState) => {
      if (unsubscribed) return;
      const trigger = getPlaybackSnapshotSaveTrigger(state, prevState);
      if (isPlaybackSnapshotEmpty(state) || trigger === "pause") {
        saveImmediately();
      } else if (trigger !== "none") {
        scheduleSave();
      }
    });

    appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "inactive" || state === "background") saveImmediately();
    });
  })();
  void initializationPromise
    .catch((error) => {
      logger.error("[播放快照] 初始化失败", error);
    })
    .finally(() => {
      initializationPromise = null;
    });
}

/** 停止持久化订阅（主要用于测试或卸载）。 */
export function teardownPlaybackSnapshotPersistence(): void {
  unsubscribed = true;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (unsubscribeFn) {
    unsubscribeFn();
    unsubscribeFn = null;
  }
  appStateSubscription?.remove();
  appStateSubscription = null;
}
