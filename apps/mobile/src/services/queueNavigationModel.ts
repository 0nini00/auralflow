import type { PlayMode } from "@/stores/playerStore";

export interface NextQueueNavigationInput {
  queueLength: number;
  currentIndex: number;
  playMode: PlayMode;
  shuffleHistory: number[];
  /** 本轮随机已播放过的索引，用于整轮去重（避免短期内重复随机到同一首） */
  playedIndices?: number[];
  random?: () => number;
}

export interface NextQueueNavigationState {
  nextIndex: number | null;
  shuffleHistory: number[];
  /** 更新后的本轮已播放索引表 */
  playedIndices: number[];
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

/**
 * 随机挑一个候选索引，优先从「本轮未播放过」的索引里选（整轮去重）。
 * 当除当前曲外的其它索引都已播放过时，视为一轮结束：清空 playedList 重新开一轮，
 * 依然排除当前曲，避免连播同一首。
 * 返回 nextIndex 与更新后的 playedIndices。
 */
function pickShuffleIndex(
  queueLength: number,
  currentIndex: number,
  playedIndices: number[],
  random: () => number,
): { nextIndex: number | null; playedIndices: number[] } {
  if (queueLength <= 0) return { nextIndex: null, playedIndices: [] };
  if (queueLength === 1) return { nextIndex: 0, playedIndices: [0] };

  const played = new Set(playedIndices);
  const allExceptCurrent = Array.from({ length: queueLength }, (_, index) => index).filter(
    (index) => index !== currentIndex,
  );

  // 本轮未播放过的候选
  let candidates = allExceptCurrent.filter((index) => !played.has(index));

  // 一轮已抽完：重置为新一轮（清空 playedList，只保留当前曲以免连播）
  let roundPlayed = playedIndices;
  if (candidates.length === 0) {
    candidates = allExceptCurrent;
    roundPlayed = currentIndex >= 0 && currentIndex < queueLength ? [currentIndex] : [];
  }

  const nextIndex = candidates[Math.floor(random() * candidates.length)] ?? candidates[0] ?? null;
  const nextPlayed = nextIndex == null ? roundPlayed : [...roundPlayed, nextIndex];
  return { nextIndex, playedIndices: nextPlayed };
}

export function getNextQueueNavigationState({
  queueLength,
  currentIndex,
  playMode,
  shuffleHistory,
  playedIndices = [],
  random = Math.random,
}: NextQueueNavigationInput): NextQueueNavigationState {
  const safeCurrentIndex = clampCurrentIndex(currentIndex, queueLength);
  if (queueLength <= 0 || safeCurrentIndex < 0) {
    return { nextIndex: null, shuffleHistory, playedIndices };
  }

  if (playMode === "shuffle") {
    const picked = pickShuffleIndex(queueLength, safeCurrentIndex, playedIndices, random);
    return {
      nextIndex: picked.nextIndex,
      shuffleHistory: [...shuffleHistory, safeCurrentIndex],
      playedIndices: picked.playedIndices,
    };
  }

  const sequentialNext = safeCurrentIndex + 1;
  if (sequentialNext < queueLength) {
    return { nextIndex: sequentialNext, shuffleHistory, playedIndices };
  }

  // 到达队尾：列表循环绕回首曲；单曲循环的「手动切歌」同样绕回首曲
  // （自动循环由 QueueEnded 的 seekTo(0) 处理，手动下一首在末尾不应无响应）；
  // 仅顺序播放到尾停止。
  if (playMode === "list" || playMode === "single") {
    return { nextIndex: 0, shuffleHistory, playedIndices };
  }

  return { nextIndex: null, shuffleHistory, playedIndices };
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

  // 进度过半回本曲开头（行业惯例）；顺序播放（不循环模式）在第一首时同样
  // 重播当前曲——与前进方向「到尾即停」对称，避免绕到队尾造成两个方向语义不一致。
  if (
    position > RESTART_PREVIOUS_THRESHOLD_SECONDS ||
    (playMode === "sequence" && safeCurrentIndex === 0)
  ) {
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

