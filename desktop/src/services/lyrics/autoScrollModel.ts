export const LYRIC_SCROLL_ANCHOR_RATIO = 0.38;
export const LYRIC_SCROLL_RESUME_DELAY_MS = 3000;
export const LYRIC_SCROLL_ADJACENT_DELAY_MS = 600;
export const LYRIC_SCROLL_ADJACENT_DURATION_MS = 600;

export interface LyricScrollMetrics {
  clientHeight: number;
  lineOffsetTop: number;
  lineHeight: number;
  scrollHeight: number;
}

export interface LyricScrollCommand {
  index: number;
  durationMs: number;
}

export interface LyricAutoScrollController {
  setTarget(index: number): void;
  beginUserScroll(): void;
  endUserScroll(): void;
  reanchor(): void;
  reset(): void;
  dispose(): void;
}

export interface LyricLineRefRegistry<T> {
  getNode(index: number): T | undefined;
  getRef(index: number): (node: T | null) => void;
}

export function createLyricLineRefRegistry<T>(): LyricLineRefRegistry<T> {
  const nodes = new Map<number, T>();
  const refs = new Map<number, (node: T | null) => void>();

  const getRef = (index: number) => {
    const existing = refs.get(index);
    if (existing) return existing;

    const callback = (node: T | null) => {
      if (node) nodes.set(index, node);
      else nodes.delete(index);
    };
    refs.set(index, callback);
    return callback;
  };

  return {
    getNode: (index) => nodes.get(index),
    getRef,
  };
}

export function calculateAnchoredLyricScrollTop({
  clientHeight,
  lineOffsetTop,
  lineHeight,
  scrollHeight,
}: LyricScrollMetrics): number {
  const rawTop = lineOffsetTop + lineHeight / 2 - clientHeight * LYRIC_SCROLL_ANCHOR_RATIO;
  const maxTop = Math.max(0, scrollHeight - clientHeight);
  return Math.max(0, Math.min(rawTop, maxTop));
}

export function createLyricAutoScrollController({
  scroll,
  canResume = () => true,
}: {
  scroll: (command: LyricScrollCommand) => void;
  canResume?: () => boolean;
}): LyricAutoScrollController {
  let target = -1;
  let previous = -1;
  let paused = false;
  let disposed = false;
  let adjacentTimer: ReturnType<typeof setTimeout> | null = null;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;

  const clearAdjacentTimer = () => {
    if (adjacentTimer == null) return;
    clearTimeout(adjacentTimer);
    adjacentTimer = null;
  };

  const clearResumeTimer = () => {
    if (resumeTimer == null) return;
    clearTimeout(resumeTimer);
    resumeTimer = null;
  };

  const emitImmediate = (index: number) => {
    if (disposed || paused || index < 0) return;
    scroll({ index, durationMs: 0 });
  };

  const setTarget = (index: number) => {
    if (disposed || index < 0 || index === target) return;
    target = index;
    clearAdjacentTimer();
    if (paused) return;

    const isAdjacent = previous >= 0 && index - previous === 1;
    previous = index;
    if (!isAdjacent) {
      emitImmediate(index);
      return;
    }

    adjacentTimer = setTimeout(() => {
      adjacentTimer = null;
      if (!paused && target === index) {
        scroll({ index, durationMs: LYRIC_SCROLL_ADJACENT_DURATION_MS });
      }
    }, LYRIC_SCROLL_ADJACENT_DELAY_MS);
  };

  const beginUserScroll = () => {
    if (disposed) return;
    paused = true;
    clearAdjacentTimer();
    clearResumeTimer();
  };

  const endUserScroll = () => {
    if (disposed || target < 0) return;
    clearResumeTimer();
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (disposed) return;
      paused = false;
      previous = target;
      if (canResume()) emitImmediate(target);
    }, LYRIC_SCROLL_RESUME_DELAY_MS);
  };

  const reanchor = () => {
    if (disposed || paused || target < 0) return;
    clearAdjacentTimer();
    previous = target;
    emitImmediate(target);
  };

  const reset = () => {
    if (disposed) return;
    clearAdjacentTimer();
    clearResumeTimer();
    target = -1;
    previous = -1;
    paused = false;
  };

  const dispose = () => {
    disposed = true;
    clearAdjacentTimer();
    clearResumeTimer();
  };

  return { setTarget, beginUserScroll, endUserScroll, reanchor, reset, dispose };
}

