import { buildSongKey, type MusicInfo } from "@lx/core";

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
  if (queue.length === 0) {
    return { queue: [song], currentIndex: 0 };
  }
  if (currentIndex < 0) {
    // 队列有歌但还没开始播放：插到队首并保留原队列，不能把整条队列替换成这一首。
    return { queue: [song, ...queue], currentIndex: 0 };
  }
  if (currentIndex >= queue.length) {
    // 当前索引已失效（例如队列被裁剪后还没同步）：插到队尾保留原队列，
    // 由 pinnedNextSong 保证下一次切歌先播它。
    return { queue: [...queue, song], currentIndex };
  }

  const insertIndex = currentIndex + 1;
  return {
    queue: [...queue.slice(0, insertIndex), song, ...queue.slice(insertIndex)],
    currentIndex,
  };
}
