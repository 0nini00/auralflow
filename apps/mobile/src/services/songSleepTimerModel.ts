const MIN_SONG_SLEEP_TIMER_COUNT = 1;
export const MAX_SONG_SLEEP_TIMER_COUNT = 50;
const MAX_SLEEP_TIMER_MINUTES = Math.floor(Number.MAX_SAFE_INTEGER / 60_000);

export const DESKTOP_ALIGNED_SLEEP_TIMER_MINUTES = [15, 30, 45, 60] as const;
export const DESKTOP_ALIGNED_SLEEP_TIMER_SONG_COUNTS = [1, 10] as const;

export interface SongSleepTimerState {
  isActive: boolean;
  remainingSongs: number;
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

/** 输入框、控制器和 store 共用舍入与范围规则。 */
export function parseSleepTimerInput(value: string | number, kind: "minutes" | "songs"): number | null {
  const count = Math.round(Number(value));
  const maximum = kind === "songs" ? MAX_SONG_SLEEP_TIMER_COUNT : MAX_SLEEP_TIMER_MINUTES;
  return Number.isSafeInteger(count) && count >= MIN_SONG_SLEEP_TIMER_COUNT && count <= maximum ? count : null;
}

export function normalizeSongSleepTimerCount(count: number): number {
  const normalized = parseSleepTimerInput(count, "songs");
  if (normalized === null) throw new RangeError(`歌曲数须为 ${MIN_SONG_SLEEP_TIMER_COUNT}-${MAX_SONG_SLEEP_TIMER_COUNT} 首`);
  return normalized;
}

/** 仅在真实歌曲播完时调用；同曲循环也消耗一首。 */
export function getNextSongSleepTimerState(
  state: SongSleepTimerState,
): SongSleepTimerState {
  if (!state.isActive) return state;

  const nextRemainingSongs = state.remainingSongs - 1;
  if (nextRemainingSongs <= 0) {
    return {
      isActive: false,
      remainingSongs: 0,
      shouldPause: true,
    };
  }

  return {
    isActive: true,
    remainingSongs: nextRemainingSongs,
    shouldPause: false,
  };
}

export function buildSleepTimerLabel(input: SleepTimerLabelInput): string {
  if (input.minuteActive && input.minuteRemaining != null) {
    return `剩余${input.minuteRemaining}分钟`;
  }
  if (input.songActive) {
    return `剩余${input.songRemaining}首`;
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
