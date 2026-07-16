import type { PlayMode } from "@/stores/playerStore";

export interface NextQueueNavigationInput {
  queueLength: number;
  currentIndex: number;
  playMode: PlayMode;
  shuffleHistory: number[];
  random?: () => number;
}

export interface NextQueueNavigationState {
  nextIndex: number | null;
  shuffleHistory: number[];
}

export interface PreviousQueueNavigationInput {
  queueLength: number;
  currentIndex: number;
  position: number;
  playMode: PlayMode;
  shuffleHistory: number[];
}

export interface PreviousQueueNavigationState {
  previousIndex: number | null;
  shouldRestartCurrent: boolean;
  shuffleHistory: number[];
}

const RESTART_PREVIOUS_THRESHOLD_SECONDS = 3;

function clampCurrentIndex(currentIndex: number, queueLength: number): number {
  if (queueLength <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= queueLength) return 0;
  return currentIndex;
}

function getRandomCandidateIndex(queueLength: number, currentIndex: number, random: () => number): number | null {
  if (queueLength <= 0) return null;
  if (queueLength === 1) return 0;
  const candidates = Array.from({ length: queueLength }, (_, index) => index).filter((index) => index !== currentIndex);
  return candidates[Math.floor(random() * candidates.length)] ?? candidates[0] ?? null;
}

export function getNextQueueNavigationState({
  queueLength,
  currentIndex,
  playMode,
  shuffleHistory,
  random = Math.random,
}: NextQueueNavigationInput): NextQueueNavigationState {
  const safeCurrentIndex = clampCurrentIndex(currentIndex, queueLength);
  if (queueLength <= 0 || safeCurrentIndex < 0) {
    return { nextIndex: null, shuffleHistory };
  }

  if (playMode === "shuffle") {
    return {
      nextIndex: getRandomCandidateIndex(queueLength, safeCurrentIndex, random),
      shuffleHistory: [...shuffleHistory, safeCurrentIndex],
    };
  }

  const sequentialNext = safeCurrentIndex + 1;
  if (sequentialNext < queueLength) {
    return { nextIndex: sequentialNext, shuffleHistory };
  }

  if (playMode === "list") {
    return { nextIndex: 0, shuffleHistory };
  }

  return { nextIndex: null, shuffleHistory };
}

export function getPreviousQueueNavigationState({
  queueLength,
  currentIndex,
  position,
  playMode,
  shuffleHistory,
}: PreviousQueueNavigationInput): PreviousQueueNavigationState {
  const safeCurrentIndex = clampCurrentIndex(currentIndex, queueLength);
  if (queueLength <= 0 || safeCurrentIndex < 0) {
    return { previousIndex: null, shouldRestartCurrent: false, shuffleHistory };
  }

  if (position > RESTART_PREVIOUS_THRESHOLD_SECONDS) {
    return {
      previousIndex: safeCurrentIndex,
      shouldRestartCurrent: true,
      shuffleHistory,
    };
  }

  if (playMode === "shuffle" && shuffleHistory.length > 0) {
    const nextHistory = [...shuffleHistory];
    const previousIndex = nextHistory.pop() ?? safeCurrentIndex;
    return {
      previousIndex,
      shouldRestartCurrent: false,
      shuffleHistory: nextHistory,
    };
  }

  const previousIndex = safeCurrentIndex - 1 >= 0 ? safeCurrentIndex - 1 : queueLength - 1;
  return {
    previousIndex,
    shouldRestartCurrent: false,
    shuffleHistory,
  };
}

