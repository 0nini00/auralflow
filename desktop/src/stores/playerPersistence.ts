/**
 * 播放会话持久化：队列 / 当前曲 / 播放位置跨重启保留（`library/playback.json`）。
 *
 * 桌面端此前完全不存播放状态 —— 只有音量写进 Rust settings，重启后队列、当前曲、
 * 播放位置全丢；移动端有等价实现（apps/mobile/src/services/playbackSnapshot.ts）。
 *
 * 恢复的语义是「上次听到哪儿」：只重建 store 与队列，**不自动播放**。
 * 引擎在启动时没有加载任何音频（状态回落 `idle`），用户按下播放时由
 * `takeResumeProgress()`（见 playerStore 的 playThroughEngine）补一次起播位置。
 */

import type { MusicInfo } from '@lx/core';
import { attachLibraryPersistence, type LibraryPersistenceController } from './libraryPersistence';
import { setResumeTarget } from './playerResumeTarget';
import { usePlayerStore, type RepeatMode } from './playerStore';

/** 落盘的播放会话；读回来必须过 [`parsePlaybackSession`] 校验后才可使用。 */
export interface PlaybackSession {
  music: MusicInfo | null;
  queue: MusicInfo[];
  currentIndex: number;
  progress: number;
  duration: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  playbackRate: number;
  savedAt: number;
}

/**
 * 进度写盘步长（秒）。
 *
 * 播放中引擎每帧都会更新 store 的 progress；若每次都调度写盘，debounce 会被不断重置，
 * 结果只在暂停/退出时才真正落盘 —— 进程被强杀就全丢。按 10 秒刻度写盘即可
 * （恢复精度足够，写盘次数从每帧降到每 10 秒一次）。
 */
export const PROGRESS_SAVE_STEP_SECONDS = 10;

/** 恢复位置距结尾不足这个秒数时按「这首已经听完」处理，从头开始。 */
const RESUME_TAIL_GUARD_SECONDS = 5;

type PlayerState = ReturnType<typeof usePlayerStore.getState>;

function isMusicLike(value: unknown): value is MusicInfo {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<MusicInfo>;
  return (
    typeof item.source === 'string' &&
    (typeof item.id === 'string' || typeof item.id === 'number') &&
    typeof item.name === 'string'
  );
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 读盘数据是不可信输入：形状不对就整份丢弃，宁可这一轮不恢复，
 * 也不要把半截 / 旧版本的垃圾灌进 store（队列里混进非法项会让 UI 与播放一起崩）。
 */
export function parsePlaybackSession(value: unknown): PlaybackSession | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const music = isMusicLike(raw.music) ? raw.music : null;
  const queue = Array.isArray(raw.queue) ? raw.queue.filter(isMusicLike) : [];
  // 既没有当前曲也没有队列：没什么可恢复的，按「没有会话」处理
  if (!music && queue.length === 0) return null;

  const repeatMode: RepeatMode =
    raw.repeatMode === 'off' || raw.repeatMode === 'one' ? raw.repeatMode : 'all';
  const playbackRate = finiteNumber(raw.playbackRate, 1);
  return {
    music,
    queue,
    currentIndex: Math.max(-1, Math.floor(finiteNumber(raw.currentIndex, music ? 0 : -1))),
    progress: Math.max(0, finiteNumber(raw.progress, 0)),
    duration: Math.max(0, finiteNumber(raw.duration, 0)),
    repeatMode,
    isShuffle: raw.isShuffle === true,
    playbackRate: playbackRate > 0 ? playbackRate : 1,
    savedAt: finiteNumber(raw.savedAt, 0),
  };
}

/** 从 store 抽取要落盘的子集。 */
export function pickPlaybackSession(state: PlayerState): PlaybackSession {
  return {
    music: state.current,
    queue: state.queue,
    currentIndex: state.currentIndex,
    progress: state.progress,
    duration: state.duration,
    repeatMode: state.repeatMode,
    isShuffle: state.isShuffle,
    playbackRate: state.playbackRate,
    savedAt: Date.now(),
  };
}

/**
 * 只在「结构性变化」或进度跨过 10 秒刻度时写盘（见 [`PROGRESS_SAVE_STEP_SECONDS`]）。
 * 状态变化（暂停 / 结束 / 出错）也算结构性变化，保证退出前落的是最新位置。
 */
export function shouldPersistPlaybackSession(state: PlayerState, previous: PlayerState): boolean {
  if (state.current !== previous.current) return true;
  if (state.queue !== previous.queue || state.currentIndex !== previous.currentIndex) return true;
  if (state.repeatMode !== previous.repeatMode || state.isShuffle !== previous.isShuffle) return true;
  if (state.playbackRate !== previous.playbackRate) return true;
  if (state.status !== previous.status) return true;
  return (
    Math.floor(state.progress / PROGRESS_SAVE_STEP_SECONDS) !==
    Math.floor(previous.progress / PROGRESS_SAVE_STEP_SECONDS)
  );
}

/**
 * 把读回来的会话合并进 store。
 *
 * 状态一律回落 `idle`：引擎里没有加载任何音频，显示成「正在播放」是假的，
 * 也会让歌词 / 歌词窗按错误的播放态走。位置另行记为待恢复位置（见 playerResumeTarget）。
 */
export function applyPlaybackSession(
  slice: PlaybackSession,
  set: (partial: Partial<PlayerState>) => void,
): void {
  set({
    current: slice.music,
    queue: slice.queue,
    currentIndex: slice.currentIndex,
    progress: slice.progress,
    duration: slice.duration,
    repeatMode: slice.repeatMode,
    isShuffle: slice.isShuffle,
    playbackRate: slice.playbackRate,
    status: 'idle',
    error: null,
    progressSampledAt: Date.now(),
  });

  if (slice.music) {
    const finished = slice.duration > 0 && slice.progress >= slice.duration - RESUME_TAIL_GUARD_SECONDS;
    setResumeTarget(slice.music, finished ? 0 : slice.progress);
  }
}

/** 读盘完成前不允许写盘，否则启动期间的一次 setState（例如恢复音量）会把空会话覆盖上去。 */
let hydrated = false;
/** StrictMode 下 App 会挂载两次；持久化只能挂一次。 */
let controller: LibraryPersistenceController | null = null;

/** 挂载播放会话持久化（幂等）。返回值用于 `flush()` 等操作。 */
export function attachPlaybackPersistence(): LibraryPersistenceController {
  if (controller) return controller;
  controller = attachLibraryPersistence<PlayerState, PlaybackSession>(usePlayerStore, {
    namespace: 'playback',
    pick: pickPlaybackSession,
    // attachLibraryPersistence 是「先订阅、后读盘」：读盘结束前必须挡住写入。
    shouldPersist: (state, previous) => hydrated && shouldPersistPlaybackSession(state, previous),
    apply: applyPlaybackSession,
    // 比默认 300ms 长一点：进度按刻度写，且退出时会 flush，不需要抢着写。
    debounceMs: 1500,
  });
  void controller.ready.then(() => {
    hydrated = true;
  });
  return controller;
}
