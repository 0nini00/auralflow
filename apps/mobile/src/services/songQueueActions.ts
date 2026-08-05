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

// ---- 稍后播放（tempPlayList）纯函数 ----
// tempPlayList 是独立的「插播暂存区」：加入的歌不污染主队列顺序，
// playNext 时优先消费——取首曲插入主队列当前曲之后并播放，插播完自动回归主队列。

export interface TempPlayListInput {
  tempPlayList: MusicInfo[];
  song: MusicInfo;
}

function songQueueKey(song: MusicInfo): string {
  return `${song.source}:${song.id}`;
}

/** 加入稍后播放；已在暂存区则保持原位不重复加入（去重，最少惊讶）。 */
export function enqueueTempPlayList({ tempPlayList, song }: TempPlayListInput): MusicInfo[] {
  const key = songQueueKey(song);
  if (tempPlayList.some((item) => songQueueKey(item) === key)) return tempPlayList;
  return [...tempPlayList, song];
}

export interface DequeueTempPlayListResult {
  nextSong: MusicInfo | null;
  tempPlayList: MusicInfo[];
}

/** 取出稍后播放的第一首，返回该曲与移除后的暂存区。空表则 nextSong 为 null。 */
export function dequeueTempPlayList(tempPlayList: MusicInfo[]): DequeueTempPlayListResult {
  if (tempPlayList.length === 0) return { nextSong: null, tempPlayList };
  const [nextSong, ...rest] = tempPlayList;
  return { nextSong, tempPlayList: rest };
}

/** 从稍后播放暂存区移除指定位置的歌。越界则原样返回。 */
export function removeFromTempPlayList(tempPlayList: MusicInfo[], index: number): MusicInfo[] {
  if (index < 0 || index >= tempPlayList.length) return tempPlayList;
  return tempPlayList.filter((_, i) => i !== index);
}
