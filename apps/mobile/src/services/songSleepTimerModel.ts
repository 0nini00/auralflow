import type { MusicInfo } from "@lx/core";

const MIN_SONG_SLEEP_TIMER_COUNT = 1;
const MAX_SONG_SLEEP_TIMER_COUNT = 50;

export const DESKTOP_ALIGNED_SLEEP_TIMER_MINUTES = [15, 30, 45, 60] as const;
export const DESKTOP_ALIGNED_SLEEP_TIMER_SONG_COUNTS = [1, 10] as const;

export interface SongSleepTimerState {
  isActive: boolean;
  remainingSongs: number;
  lastTrackKey: string | null;
  shouldPause?: boolean;
}

export interface SleepTimerLabelInput {
  minuteActive: boolean;
  minuteRemaining: number | null;
  songActive: boolean;
  songRemaining: number;
}

export interface MobileSleepTimerControl {
  label: string;
  active: boolean;
  minutePresets: readonly number[];
  songCountPresets: readonly number[];
}

export function getSongSleepTimerTrackKey(song: MusicInfo | null | undefined): string | null {
  return song ? `${song.source}:${song.id}` : null;
}

export function normalizeSongSleepTimerCount(count: number): number {
  if (!Number.isFinite(count)) return MIN_SONG_SLEEP_TIMER_COUNT;
  const normalized = Math.floor(count);
  return Math.min(MAX_SONG_SLEEP_TIMER_COUNT, Math.max(MIN_SONG_SLEEP_TIMER_COUNT, normalized));
}

export function getNextSongSleepTimerState(
  state: SongSleepTimerState,
  currentSong: MusicInfo | null | undefined,
): SongSleepTimerState {
  if (!state.isActive) return state;

  const currentTrackKey = getSongSleepTimerTrackKey(currentSong);
  if (!currentTrackKey || currentTrackKey === state.lastTrackKey) return state;

  const nextRemainingSongs = state.remainingSongs - 1;
  if (nextRemainingSongs <= 0) {
    return {
      isActive: false,
      remainingSongs: 0,
      lastTrackKey: null,
      shouldPause: true,
    };
  }

  return {
    isActive: true,
    remainingSongs: nextRemainingSongs,
    lastTrackKey: currentTrackKey,
    shouldPause: false,
  };
}

export function buildSleepTimerLabel(input: SleepTimerLabelInput): string {
  if (input.minuteActive && input.minuteRemaining != null) {
    return `睡眠 剩余${input.minuteRemaining}分钟`;
  }
  if (input.songActive) {
    return `睡眠 剩余${input.songRemaining}首`;
  }
  return "睡眠";
}

export function buildMobileSleepTimerControl(input: SleepTimerLabelInput): MobileSleepTimerControl {
  return {
    label: buildSleepTimerLabel(input),
    active: input.minuteActive || input.songActive,
    minutePresets: DESKTOP_ALIGNED_SLEEP_TIMER_MINUTES,
    songCountPresets: DESKTOP_ALIGNED_SLEEP_TIMER_SONG_COUNTS,
  };
}
