// URL 解析、原生加载与歌词写回共享同一播放意图，清空队列也会使旧意图失效。
let currentRequestId = 0;
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


export function subscribePlaybackRequest(listener: () => void): () => void {
  requestListeners.add(listener);
  return () => { requestListeners.delete(listener); };
}
