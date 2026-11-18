import type { MusicInfo } from "@lx/core";
import type { StoreApi } from "zustand";
import type { PlayModeId } from "@/services/playback/playModeControl";

export type RepeatMode = "off" | "all" | "one";

export interface PlayerStore {
  current: MusicInfo | null;
  queue: MusicInfo[];
  currentIndex: number;
  status: "idle" | "loading" | "playing" | "paused" | "error";
  progress: number;

  /** progress 的 engine 采样时刻（Date.now() 墙钟基准）；跨 WebView 快照直接透传，无需换算 */
  progressSampledAt: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  error: string | null;

  /** 跨源降级等一次性播放提示；约 10s 后自动清除 */
  playbackNotice: string | null;

  /** 私人 FM 模式：true 时播放结束/手动 next 走 discoveryStore.fmNext */
  fmMode: boolean;

  /** 随机模式下记录播放历史索引，用于 prev() 回退到真正上一首 */
  playHistory: number[];

  /** FM 模式下已播过的曲目栈（不在 queue 里，prev() 需要它回退） */
  fmHistory: MusicInfo[];

  /** 「下一首播放」锚点：随机 / FM 模式取下一首时优先消费（只存曲目身份，避免下标漂移） */
  pinnedNextSong: MusicInfo | null;

  play: (music: MusicInfo) => Promise<void>;
  playQueue: (queue: MusicInfo[], startIndex?: number) => Promise<void>;
  playByIndex: (index: number) => Promise<void>;
  addToQueue: (music: MusicInfo) => void;
  playNext: (music: MusicInfo) => void;
  removeFromQueue: (index: number) => void;
  /** 撤销移除：把歌曲插回原索引，并同步平移当前曲与历史下标。 */
  insertQueueAt: (index: number, music: MusicInfo) => void;
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
  notifyPlaybackNotice: (text: string) => void;
}

/** store 创建函数拿到的 set / get；拆出去的动作模块靠参数接收它们，不反向导入 playerStore。 */
export type PlayerSet = StoreApi<PlayerStore>["setState"];
export type PlayerGet = StoreApi<PlayerStore>["getState"];
