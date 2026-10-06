import { beginPlaybackRequest, isCurrentPlaybackRequest, subscribePlaybackRequest } from "./playbackRequest";

export const PLAYBACK_RESOLUTION_BUDGET_MS = 12_000;
let activeResolutionRequest: number | null = null;

export class PlaybackRequestSupersededError extends Error {
  constructor() {
    super("播放请求已被新的操作替代");
    this.name = "PlaybackRequestSupersededError";
  }
}

/** 手动媒体按键可抢占解析，但不与正在提交的原生队列操作交错。 */
export function interruptPlaybackResolution(): boolean {
  if (activeResolutionRequest === null || !isCurrentPlaybackRequest(activeResolutionRequest)) return false;
  beginPlaybackRequest();
  return true;
}

/** 预算覆盖整个异步解析流程，包括预读等待与跨源候选；预读不持有播放意图。 */
export function runPlaybackResolution<T>(resolve: () => Promise<T>, requestId?: number): Promise<T> {
  if (requestId !== undefined && !isCurrentPlaybackRequest(requestId)) return Promise.reject(new PlaybackRequestSupersededError());
  if (requestId !== undefined) activeResolutionRequest = requestId;
  return new Promise<T>((fulfill, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (requestId !== undefined && activeResolutionRequest === requestId) activeResolutionRequest = null;
      action();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("播放地址解析超时（12 秒），可重试或切换歌曲"))), PLAYBACK_RESOLUTION_BUDGET_MS);
    if (requestId !== undefined) {
      unsubscribe = subscribePlaybackRequest(() => {
        if (!isCurrentPlaybackRequest(requestId)) finish(() => reject(new PlaybackRequestSupersededError()));
      });
    }
    Promise.resolve().then(() => {
      if (settled) throw new PlaybackRequestSupersededError();
      return resolve();
    }).then(
      result => finish(() => fulfill(result)),
      error => finish(() => reject(error)),
    );
  });
}
