import { create } from "zustand";
import { usePlayerStore } from "./playerStore";

export type SleepMode = "off" | "timer" | "songs";

interface SleepTimerState {
  mode: SleepMode;
  /** 定时模式剩余秒数 */
  remainingSec: number;
  /** 按歌曲模式剩余歌曲数 */
  remainingSongs: number;

  startTimer: (minutes: number) => void;
  startSongs: (count: number) => void;
  /** 返回 true 表示本次播放完成后应停止，不再进入下一首。 */
  consumeCompletedSong: () => boolean;
  cancel: () => void;
}

const MIN_THRESHOLD_SEC = 120;

let tickHandle: ReturnType<typeof setInterval> | null = null;

function clearTick() {
  if (tickHandle != null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function startTick() {
  clearTick();
  tickHandle = setInterval(() => {
    const st = useSleepTimerStore.getState();
    if (st.mode !== "timer") {
      // 定时已结束/被取消：停掉这个每秒空转的定时器，
      // 否则用过一次定时后，整进程会一直留着一个 1s interval。
      clearTick();
      return;
    }
    const player = usePlayerStore.getState();
    if (player.status !== "playing") return;
    const next = st.remainingSec - 1;
    if (next <= 0) {
      usePlayerStore.getState().pause();
      useSleepTimerStore.setState({ mode: "off", remainingSec: 0 });
      clearTick();
    } else {
      useSleepTimerStore.setState({ remainingSec: next });
    }
  }, 1000);
}

export const useSleepTimerStore = create<SleepTimerState>((set, get) => ({
  mode: "off",
  remainingSec: 0,
  remainingSongs: 0,
  startTimer: (minutes) => {
    set({
      mode: "timer",
      remainingSec: Math.max(MIN_THRESHOLD_SEC, Math.floor(minutes * 60)),
      remainingSongs: 0,
    });
    startTick();
  },

  startSongs: (count) => {
    clearTick();
    set({ mode: "songs", remainingSongs: Math.max(1, count), remainingSec: 0 });
  },

  consumeCompletedSong: () => {
    const state = get();
    if (state.mode !== 'songs') return false;
    const remainingSongs = Math.max(0, state.remainingSongs - 1);
    set({ remainingSongs, mode: remainingSongs === 0 ? 'off' : 'songs' });
    return remainingSongs === 0;
  },

  cancel: () => {
    clearTick();
    set({ mode: "off", remainingSec: 0, remainingSongs: 0 });
  },
}));
