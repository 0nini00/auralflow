// URL 解析、原生加载与歌词写回共享同一播放意图，清空队列也会使旧意图失效。
let currentRequestId = 0;
let playbackSeekRevision = 0;
const requestListeners = new Set<() => void>();

export function beginPlaybackRequest(): number {
  currentRequestId += 1;
  for (const notify of [...requestListeners]) notify();
  return currentRequestId;
}

export function getCurrentPlaybackRequestId(): number {
  return currentRequestId;
}

export function isCurrentPlaybackRequest(requestId: number): boolean {
  return requestId === currentRequestId;
}

/** 手动 seek 是进度不连续的边界，不能算作候选已健康解码。 */
export function notePlaybackSeek(): void {
  playbackSeekRevision += 1;
}

export function getPlaybackSeekRevision(): number {
  return playbackSeekRevision;
}


export function subscribePlaybackRequest(listener: () => void): () => void {
  requestListeners.add(listener);
  return () => { requestListeners.delete(listener); };
}
