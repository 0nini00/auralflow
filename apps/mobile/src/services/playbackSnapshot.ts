import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MusicInfo } from "@lx/core";
import { usePlayerStore, type PlayMode, type PlaybackContext } from "../stores/playerStore";
import { clampPlaybackRate, DEFAULT_PLAYBACK_RATE } from "@/services/playerRateModel";
import { normalizePersistedVolumeState } from "@/services/playerVolumeModel";

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

/** 保存当前播放状态到 AsyncStorage。 */
export async function savePlaybackSnapshot(): Promise<void> {
  try {
    const snapshot = buildSnapshot();
    // 空状态不写盘，避免覆盖有效快照
    if (!snapshot.currentSong && snapshot.queue.length === 0) return;
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn("[snapshot] 保存失败", error);
  }
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
      // personalFm 上下文无法离线恢复缓冲，退化为 queue
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

    return snapshot;
  } catch (error) {
    console.warn("[snapshot] 恢复失败", error);
    return null;
  }
}

export async function clearPlaybackSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SNAPSHOT_KEY);
  } catch (error) {
    console.warn("[snapshot] 清除失败", error);
  }
}

// ─────────────────────────────────────────────────────────────
// 订阅 store 变化，debounce 保存
// ─────────────────────────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribed = false;
let unsubscribeFn: (() => void) | null = null;

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void savePlaybackSnapshot();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * 初始化播放快照持久化：启动时恢复一次，并订阅 store 变化 debounce 保存。
 * 应在应用启动时调用一次。
 */
export function initPlaybackSnapshotPersistence(): void {
  if (unsubscribeFn) return; // 防止重复初始化

  // 1. 启动恢复
  void loadPlaybackSnapshot();

  // 2. 订阅变化 debounce 保存
  unsubscribeFn = usePlayerStore.subscribe((state, prevState) => {
    if (unsubscribed) return;
    // 只在播放相关字段变化时触发保存
    if (
      state.currentSong !== prevState.currentSong ||
      state.queue !== prevState.queue ||
      state.currentIndex !== prevState.currentIndex ||
      state.shuffleHistory !== prevState.shuffleHistory ||
      state.playMode !== prevState.playMode ||
      state.playbackRate !== prevState.playbackRate ||
      state.volume !== prevState.volume ||
      state.previousVolume !== prevState.previousVolume ||
      state.isMuted !== prevState.isMuted ||
      state.playbackContext !== prevState.playbackContext
    ) {
      scheduleSave();
    }
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
}


