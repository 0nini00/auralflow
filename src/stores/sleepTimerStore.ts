import { create } from "zustand";
import { usePlayerStore } from "./playerStore";

export type SleepMode = "off" | "timer" | "songs";

interface SleepTimerState {
  mode: SleepMode;
  /** 定时模式剩余秒数 */
  remainingSec: number;
  /** 按歌曲模式剩余歌曲数 */
  remainingSongs: number;
  /** 已设定的总分钟数（用于 UI 显示） */
  totalMinutes: number;

  startTimer: (minutes: number) => void;
  startSongs: (count: number) => void;
  cancel: () => void;
}

const MIN_THRESHOLD_SEC = 120;

let tickHandle: ReturnType<typeof setInterval> | null = null;
let lastTrackKey: string | null = null;
let songsWatcherActive = false;

function clearTick() {
  if (tickHandle != null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function trackKey(): string | null {
  const c = usePlayerStore.getState().current;
  return c ? `${c.source}:${c.id}` : null;
}

function ensureSongsWatcher() {
  if (songsWatcherActive) return;
  songsWatcherActive = true;
  lastTrackKey = trackKey();
  usePlayerStore.subscribe(() => {
    const key = trackKey();
    if (key === lastTrackKey) return;
    lastTrackKey = key;
    const st = useSleepTimerStore.getState();
    if (st.mode !== "songs") return;
    const next = st.remainingSongs - 1;
    if (next <= 0) {
      usePlayerStore.getState().pause();
      useSleepTimerStore.setState({ mode: "off", remainingSongs: 0 });
    } else {
      useSleepTimerStore.setState({ remainingSongs: next });
    }
  });
}

function startTick() {
  clearTick();
  tickHandle = setInterval(() => {
    const st = useSleepTimerStore.getState();
    if (st.mode !== "timer") return;
    const player = usePlayerStore.getState();
    if (player.status !== "playing") return;
    const next = st.remainingSec - 1;
    if (next <= 0) {
      usePlayerStore.getState().pause();
      useSleepTimerStore.setState({ mode: "off", remainingSec: 0 });
    } else {
      useSleepTimerStore.setState({ remainingSec: next });
    }
  }, 1000);
}

export const useSleepTimerStore = create<SleepTimerState>((set) => ({
  mode: "off",
  remainingSec: 0,
  remainingSongs: 0,
  totalMinutes: 0,

  startTimer: (minutes) => {
    set({
      mode: "timer",
      remainingSec: Math.max(MIN_THRESHOLD_SEC, Math.floor(minutes * 60)),
      totalMinutes: minutes,
      remainingSongs: 0,
    });
    startTick();
  },

  startSongs: (count) => {
    set({ mode: "songs", remainingSongs: Math.max(1, count), remainingSec: 0 });
    ensureSongsWatcher();
  },

  cancel: () => {
    clearTick();
    // 重置 songs watcher 状态，让下次 startSongs 能重新注册并同步当前曲目
    songsWatcherActive = false;
    lastTrackKey = null;
    set({ mode: "off", remainingSec: 0, remainingSongs: 0 });
  },
}));
