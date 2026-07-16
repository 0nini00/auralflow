import type { MusicInfo } from "@lx/core";

export interface QueueInsertInput {
  queue: MusicInfo[];
  currentIndex: number;
  song: MusicInfo;
}

export interface QueueInsertResult {
  queue: MusicInfo[];
  currentIndex: number;
}

export interface SongQueueActionLabels {
  playNextLabel: string;
  addToQueueLabel: string;
}

export function buildSongQueueActionLabels(): SongQueueActionLabels {
  return {
    playNextLabel: "下首",
    addToQueueLabel: "队列",
  };
}

export function insertSongAtQueueEnd({ queue, currentIndex, song }: QueueInsertInput): QueueInsertResult {
  return {
    queue: [...queue, song],
    currentIndex,
  };
}

export function insertSongToPlayNext({ queue, currentIndex, song }: QueueInsertInput): QueueInsertResult {
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) {
    return {
      queue: [song],
      currentIndex: 0,
    };
  }

  const insertIndex = currentIndex + 1;
  return {
    queue: [...queue.slice(0, insertIndex), song, ...queue.slice(insertIndex)],
    currentIndex,
  };
}
