import type { MusicInfo } from "../sources";

export const DEFAULT_HEARTBEAT_REFILL_THRESHOLD = 5;

/**
 * 判断心动模式当前的待播缓冲是否低于阈值需补充新歌曲。
 */
export function shouldRefillHeartbeat(
  bufferLength: number,
  threshold = DEFAULT_HEARTBEAT_REFILL_THRESHOLD,
): boolean {
  return bufferLength < threshold;
}

export interface ConsumeHeartbeatResult {
  nextSong: MusicInfo | null;
  nextBatch: MusicInfo[];
  nextBatchIndex: number;
  nextBuffer: MusicInfo[];
  needsRefill: boolean;
}

/**
 * 推进心动模式下一曲。
 * 优先在当前 batch 内推进；当 batch 播尽时，从 buffer 头部取出一首推进并追加至 batch。
 */
export function consumeHeartbeatNext(
  currentBatch: MusicInfo[],
  currentBatchIndex: number,
  buffer: MusicInfo[],
  refillThreshold = DEFAULT_HEARTBEAT_REFILL_THRESHOLD,
): ConsumeHeartbeatResult {
  const nextInBatchIndex = currentBatchIndex + 1;
  if (nextInBatchIndex < currentBatch.length) {
    return {
      nextSong: currentBatch[nextInBatchIndex],
      nextBatch: currentBatch,
      nextBatchIndex: nextInBatchIndex,
      nextBuffer: buffer,
      needsRefill: shouldRefillHeartbeat(buffer.length, refillThreshold),
    };
  }

  if (buffer.length > 0) {
    const [nextSong, ...nextBuffer] = buffer;
    const nextBatch = [...currentBatch, nextSong];
    const nextBatchIndex = nextBatch.length - 1;
    return {
      nextSong,
      nextBatch,
      nextBatchIndex,
      nextBuffer,
      needsRefill: shouldRefillHeartbeat(nextBuffer.length, refillThreshold),
    };
  }

  return {
    nextSong: null,
    nextBatch: currentBatch,
    nextBatchIndex: currentBatchIndex,
    nextBuffer: [],
    needsRefill: true,
  };
}

export interface AppendHeartbeatRefillResult {
  nextBuffer: MusicInfo[];
  addedCount: number;
}

/**
 * 将远端拉取的续批推荐歌曲去重后追加进心动模式 buffer。
 */
export function appendHeartbeatRefill(
  currentBuffer: MusicInfo[],
  incomingSongs: MusicInfo[],
  existingKeys: ReadonlySet<string>,
): AppendHeartbeatRefillResult {
  const seen = new Set(existingKeys);
  for (const s of currentBuffer) {
    seen.add(`${s.source}:${s.id}`);
  }

  const fresh: MusicInfo[] = [];
  for (const song of incomingSongs) {
    const key = `${song.source}:${song.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      fresh.push(song);
    }
  }

  return {
    nextBuffer: [...currentBuffer, ...fresh],
    addedCount: fresh.length,
  };
}
