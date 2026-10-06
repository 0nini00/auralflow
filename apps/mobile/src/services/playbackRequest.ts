// URL 解析、原生加载与歌词写回共享同一播放意图，清空队列也会使旧意图失效。
let currentRequestId = 0;

export function beginPlaybackRequest(): number {
  currentRequestId += 1;
  return currentRequestId;
}

export function getCurrentPlaybackRequestId(): number {
  return currentRequestId;
}

export function isCurrentPlaybackRequest(requestId: number): boolean {
  return requestId === currentRequestId;
}
